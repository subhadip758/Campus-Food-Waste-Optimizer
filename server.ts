import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { z } from "zod";
import { OpenAI } from "openai";
import { zodResponseFormat } from "openai/helpers/zod";

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 7860;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "dummy" });

app.use(express.json());

// --- Zod schemas ---
const DietEnum = z.enum(["Standard", "Vegan", "Gluten-Free"]);

const TransferSchema = z.object({
  from_hall: z.string(),
  to_hall: z.string(),
  diet: DietEnum,
  quantity: z.number().int().min(0),
});

const OrderSchema = z.object({
  hall_id: z.string(),
  diet: DietEnum,
  quantity: z.number().int().min(0),
  is_emergency: z.boolean(),
});

const ActionSchema = z.object({
  preps: z.record(z.string(), z.record(z.string(), z.number().int().min(0))),
  transfers: z.array(TransferSchema).optional().default([]),
  orders: z.array(OrderSchema).optional().default([]),
});

type Action = z.infer<typeof ActionSchema>;

interface Batch {
  quantity: number;
  expiry_day: number;
}

interface OrderQueueItem {
  diet: string;
  quantity: number;
  arrival_day: number;
}

interface HallState {
  inventory_raw: Record<string, Batch[]>; // diet -> batches
  expected_turnout: Record<string, number>; // diet -> base expected
  order_queue: OrderQueueItem[];
}

interface State {
  day: number;
  max_days: number;
  task_id: string;
  halls: Record<string, HallState>;
  weather: string;
  events: string[];
  total_waste: number;
  total_spoiled: number;
  total_shortage: number;
  students_fed: number;
  total_profit: number;
  total_transfer_cost: number;
  total_order_cost: number;
  history: any[];
}

let currentState: State | null = null;

const WEATHER_TYPES = ["Sunny", "Rainy", "Extreme", "Normal"];

// Helper functions
function calculateDemand(hall_id: string, base: Record<string, number>, weather: string, events: string[]): Record<string, number> {
  let demand: Record<string, number> = { Standard: base.Standard || 0, Vegan: base.Vegan || 0, "Gluten-Free": base["Gluten-Free"] || 0 };
  
  if (weather === "Rainy" && hall_id === "central") { demand.Standard -= 20; demand.Vegan -= 10; } // Drops in rain
  if (weather === "Rainy" && hall_id !== "central") { demand.Standard += 10; demand.Vegan += 5; } // Dorms increase in rain
  if (weather === "Extreme") { 
     demand.Standard = Math.floor(demand.Standard * 0.5);   // Everyone stays in
     demand.Vegan = Math.floor(demand.Vegan * 0.5);
     demand["Gluten-Free"] = Math.floor(demand["Gluten-Free"] * 0.5);
  }

  if (events.includes("Football Game") && hall_id === "stadium_hall") {
      demand.Standard += 100;
      demand.Vegan += 20;
  }
  if (events.includes("Health Week")) {
      demand.Vegan += 40;
      demand.Standard -= 20;
  }

  // noise
  demand.Standard = Math.max(0, demand.Standard + (Math.floor(Math.random() * 20) - 10));
  demand.Vegan = Math.max(0, demand.Vegan + (Math.floor(Math.random() * 8) - 4));
  demand["Gluten-Free"] = Math.max(0, demand["Gluten-Free"] + (Math.floor(Math.random() * 4) - 2));

  return demand;
}

function consumeInventory(inventory: Batch[], amount: number): { consumed: number, remaining: Batch[] } {
  let sorted = [...inventory].sort((a, b) => a.expiry_day - b.expiry_day);
  let to_consume = amount;
  let consumed = 0;

  for (let batch of sorted) {
    if (to_consume <= 0) break;
    const take = Math.min(batch.quantity, to_consume);
    batch.quantity -= take;
    to_consume -= take;
    consumed += take;
  }
  
  return { consumed, remaining: sorted.filter(b => b.quantity > 0) };
}

function processSpoilage(inventory: Record<string, Batch[]>, current_day: number): { spoiled: number, remaining: Record<string, Batch[]> } {
  let spoiled = 0;
  const remaining: Record<string, Batch[]> = {};
  
  for (const diet of ["Standard", "Vegan", "Gluten-Free"]) {
    remaining[diet] = [];
    for (let batch of (inventory[diet] || [])) {
      if (batch.expiry_day <= current_day) spoiled += batch.quantity;
      else remaining[diet].push(batch);
    }
  }
  return { spoiled, remaining };
}

export function resetEnv(task_id: string): any {
  if (task_id === "easy_inventory_management") {
    currentState = {
      day: 0,
      max_days: 3,
      task_id,
      halls: {
        "main_hall": {
          inventory_raw: { "Standard": [{ quantity: 150, expiry_day: 5 }], "Vegan": [{ quantity: 50, expiry_day: 5 }], "Gluten-Free": [{ quantity: 20, expiry_day: 5 }] },
          expected_turnout: { "Standard": 100, "Vegan": 30, "Gluten-Free": 10 },
          order_queue: []
        }
      },
      weather: "Normal",
      events: [],
      total_waste: 0, total_spoiled: 0, total_shortage: 0, students_fed: 0, total_profit: 0, total_transfer_cost: 0, total_order_cost: 0, history: []
    };
  } else if (task_id === "medium_multi_hall_transfer") {
    currentState = {
      day: 0,
      max_days: 3,
      task_id,
      halls: {
        "hall_a": {
          inventory_raw: { "Standard": [{ quantity: 200, expiry_day: 1 }], "Vegan": [], "Gluten-Free": [] }, // Expiring tomorrow!
          expected_turnout: { "Standard": 50, "Vegan": 10, "Gluten-Free": 5 },
          order_queue: []
        },
        "hall_b": {
          inventory_raw: { "Standard": [], "Vegan": [{ quantity: 50, expiry_day: 2 }], "Gluten-Free": [] }, // Empty standard!
          expected_turnout: { "Standard": 150, "Vegan": 40, "Gluten-Free": 10 },
          order_queue: []
        }
      },
      weather: "Normal",
      events: [],
      total_waste: 0, total_spoiled: 0, total_shortage: 0, students_fed: 0, total_profit: 0, total_transfer_cost: 0, total_order_cost: 0, history: []
    };
  } else { // hard_dynamic_optimization
    currentState = {
      day: 0,
      max_days: 7,
      task_id: "hard_dynamic_optimization",
      halls: {
        "central": { inventory_raw: { "Standard": [{ quantity: 100, expiry_day: 3 }], "Vegan": [], "Gluten-Free": [] }, expected_turnout: { "Standard": 200, "Vegan": 50, "Gluten-Free": 20 }, order_queue: [] },
        "north_dorm": { inventory_raw: { "Standard": [{ quantity: 50, expiry_day: 3 }], "Vegan": [], "Gluten-Free": [] }, expected_turnout: { "Standard": 100, "Vegan": 30, "Gluten-Free": 10 }, order_queue: [] },
        "stadium_hall": { inventory_raw: { "Standard": [{ quantity: 50, expiry_day: 5 }], "Vegan": [], "Gluten-Free": [] }, expected_turnout: { "Standard": 50, "Vegan": 10, "Gluten-Free": 5 }, order_queue: [] }
      },
      weather: "Sunny",
      events: [],
      total_waste: 0, total_spoiled: 0, total_shortage: 0, students_fed: 0, total_profit: 0, total_transfer_cost: 0, total_order_cost: 0, history: []
    };
  }
  return getObservation();
}

function getObservation() {
  if (!currentState) resetEnv("easy_inventory_management");
  const s = currentState!;
  
  const obs_halls: Record<string, any> = {};
  for (const [hall_id, h] of Object.entries(s.halls)) {
    const raw_totals: Record<string, number> = { Standard: 0, Vegan: 0, "Gluten-Free": 0 };
    for (const diet of Object.keys(raw_totals)) {
        raw_totals[diet] = (h.inventory_raw[diet] || []).reduce((acc, b) => acc + b.quantity, 0);
    }
      
    obs_halls[hall_id] = {
      inventory_totals: raw_totals,
      inventory_components: h.inventory_raw,
      expected_turnout: h.expected_turnout,
      incoming_orders: h.order_queue
    };
  }

  return {
    day: s.day,
    current_meal: "Lunch",
    weather: s.weather,
    events: s.events,
    halls: obs_halls
  };
}

function step(action: Action) {
  if (!currentState) resetEnv("easy_inventory_management");
  const s = currentState!;
  let reward = 0;
  
  // 0. Process Arriving Orders
  for (const [hall_id, h] of Object.entries(s.halls)) {
     const still_delivering = [];
     for (const o of h.order_queue) {
         if (o.arrival_day === s.day) {
             if (!h.inventory_raw[o.diet]) h.inventory_raw[o.diet] = [];
             h.inventory_raw[o.diet].push({ quantity: o.quantity, expiry_day: s.day + 5 });
         } else {
             still_delivering.push(o);
         }
     }
     h.order_queue = still_delivering;
  }

  // 1. Process transfers (costs 0.1 per unit)
  for (const t of action.transfers || []) {
    if (s.halls[t.from_hall] && s.halls[t.to_hall]) {
      const from_inv = s.halls[t.from_hall].inventory_raw[t.diet] || [];
      const { consumed, remaining } = consumeInventory(from_inv, t.quantity);
      s.halls[t.from_hall].inventory_raw[t.diet] = remaining;
      
      if (consumed > 0) {
        if (!s.halls[t.to_hall].inventory_raw[t.diet]) s.halls[t.to_hall].inventory_raw[t.diet] = [];
        s.halls[t.to_hall].inventory_raw[t.diet].push({ quantity: consumed, expiry_day: s.day + 2 });
        reward -= consumed * 0.1;
        s.total_transfer_cost += consumed * 0.1;
      }
    }
  }

  // 2. Process preps and serve students
  let daily_waste = 0;
  let daily_shortage = 0;
  let daily_fed = 0;
  let daily_spoiled = 0;

  for (const [hall_id, h] of Object.entries(s.halls)) {
    const demand = calculateDemand(hall_id, h.expected_turnout, s.weather, s.events);
    
    for (const diet of ["Standard", "Vegan", "Gluten-Free"]) {
        const req_prep = action.preps[hall_id]?.[diet as any] || 0;
        const from_inv = h.inventory_raw[diet] || [];
        const { consumed: prepped, remaining: after_prep } = consumeInventory(from_inv, req_prep);
        h.inventory_raw[diet] = after_prep;

        const d_demand = demand[diet] || 0;
        const sold = Math.min(prepped, d_demand);
        const waste = Math.max(0, prepped - d_demand);
        const shortage = Math.max(0, d_demand - prepped);

        daily_waste += waste;
        daily_shortage += shortage;
        daily_fed += sold;

        reward += sold * 1.0;
        reward -= waste * 2.0;
        reward -= shortage * 5.0;
    }

    // Process spoilage
    const { spoiled, remaining: after_spoil } = processSpoilage(h.inventory_raw, s.day);
    h.inventory_raw = after_spoil;
    daily_spoiled += spoiled;
    reward -= spoiled * 2.0;
  }

  // 3. Process new orders
  for (const o of action.orders || []) {
      if (s.halls[o.hall_id]) {
          const cost = o.is_emergency ? o.quantity * 10.0 : o.quantity * 2.0;
          reward -= cost;
          s.total_order_cost += cost;
          s.halls[o.hall_id].order_queue.push({
              diet: o.diet,
              quantity: o.quantity,
              arrival_day: o.is_emergency ? s.day + 1 : s.day + 3
          });
      }
  }

  s.day += 1;
  s.total_waste += daily_waste;
  s.total_shortage += daily_shortage;
  s.total_spoiled += daily_spoiled;
  s.students_fed += daily_fed;
  s.total_profit += reward;
  s.history.push({ reward });

  // Update next day dynamics (for hard mode)
  if (s.task_id === "hard_dynamic_optimization") {
      s.weather = WEATHER_TYPES[Math.floor(Math.random() * WEATHER_TYPES.length)];
      if (s.day === 2) s.events = ["Football Game"];
      else if (s.day === 5) s.events = ["Health Week"];
      else s.events = [];
  }

  return {
    observation: getObservation(),
    reward,
    done: s.day >= s.max_days,
    info: { daily_waste, daily_shortage, daily_spoiled, daily_fed }
  };
}

// --- Endpoints ---

app.post("/api/reset", (req, res) => {
  const task_id = req.body?.task_id || "easy_inventory_management";
  res.json(resetEnv(task_id));
});

app.post("/api/step", (req, res) => {
  try {
    const action = ActionSchema.parse(req.body);
    res.json(step(action));
  } catch (e) {
    res.status(400).json({ error: "Invalid action schema", details: JSON.stringify(e) });
  }
});

app.get("/api/state", (req, res) => {
  if (!currentState) resetEnv("easy_inventory_management");
  res.json(currentState);
});

app.get("/api/tasks", (req, res) => {
  res.json([
    { id: "easy_inventory_management", name: "Predictable Prep", description: "1 hall. Handle multi-diet tracking." },
    { id: "medium_multi_hall_transfer", name: "Spoilage Mitigation", description: "2 halls. Move food across campus to prevent expiry." },
    { id: "hard_dynamic_optimization", name: "Horizon Supply Chain", description: "3 halls. Changing events and severe order lead-times." },
  ]);
});

app.post("/api/grader", (req, res) => {
  const { trajectory, task_id } = req.body;
  if (!trajectory || trajectory.length === 0) return res.json({ score: 0 });
  const totalReward = trajectory.reduce((sum: number, step: any) => sum + step.reward, 0);

  let score = 0;
  if (task_id === "easy_inventory_management") {
      score = Math.max(0, Math.min(1, (totalReward + 500) / 800));
  } else if (task_id === "medium_multi_hall_transfer") {
      score = Math.max(0, Math.min(1, (totalReward + 1000) / 1200));
  } else {
      score = Math.max(0, Math.min(1, (totalReward + 3000) / 4000));
  }
  
  res.json({ score: Number(score.toFixed(3)) });
});

app.get("/api/ai-action", async (req, res) => {
  try {
    const obs = getObservation();
    
    if (!process.env.OPENAI_API_KEY) {
       return res.json({ preps: { "main_hall": { "Standard": 100, "Vegan": 0, "Gluten-Free": 0 } }, transfers: [], orders: [] });
    }

    // @ts-ignore
    const completion = await openai.beta.chat.completions.parse({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an AI Campus Food Operations manager resolving logistics. Minimize waste and avoid shortages by prepping correctly per diet. Anticipate 3-day delays for standard orders, use emergency orders ($10) ONLY if desperate. \nState: ${JSON.stringify(obs, null, 2)}`
        }
      ],
      response_format: zodResponseFormat(ActionSchema, "action_plan"),
      temperature: 0.2, // deterministic logic
    });
    
    res.json(completion.choices[0].message.parsed);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/baseline", async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({ error: "OPENAI_API_KEY required for /baseline" });
  }
  
  const tasks = ["easy_inventory_management", "medium_multi_hall_transfer", "hard_dynamic_optimization"];
  const results: any = {};
  
  for (const tid of tasks) {
    resetEnv(tid);
    let done = false;
    let trajectory = [];
    
    while (!done) {
        const obs = getObservation();
        // @ts-ignore
        const completion = await openai.beta.chat.completions.parse({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: `You are an AI Food Mgr. Optimize Standard/Vegan/Gluten-Free. Obs: ${JSON.stringify(obs)}` }],
          response_format: zodResponseFormat(ActionSchema, "action_plan"),
          temperature: 0.2
        });
        
        const action = ActionSchema.parse(completion.choices[0].message.parsed);
        const stepRes = step(action);
        trajectory.push(stepRes);
        done = stepRes.done;
    }
    
    const totalReward = trajectory.reduce((sum: number, st: any) => sum + st.reward, 0);
    let score = 0;
    if (tid === "easy_inventory_management") score = Math.max(0, Math.min(1, (totalReward + 500) / 800));
    else if (tid === "medium_multi_hall_transfer") score = Math.max(0, Math.min(1, (totalReward + 1000) / 1200));
    else score = Math.max(0, Math.min(1, (totalReward + 3000) / 4000));
    
    results[tid] = { score: Number(score.toFixed(3)), steps: trajectory.length };
  }
  
  res.json({ baseline_scores: results });
});

// --- Vite Middleware ---

if (!process.env.VERCEL) {
  async function startServer() {
    if (process.env.NODE_ENV !== "production") {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }

  startServer();
}

export default app;
