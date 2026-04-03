import { OpenAI } from "openai";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const TransferSchema = z.object({
  from_hall: z.string(),
  to_hall: z.string(),
  quantity: z.number().int().min(0),
});

const ActionSchema = z.object({
  preps: z.record(z.string(), z.number().int().min(0)),
  transfers: z.array(TransferSchema).default([]),
  orders: z.record(z.string(), z.number().int().min(0)).default({}),
});

const BASE_URL = "http://127.0.0.1:7860/api";

async function runTask(task_id: string) {
  console.log(`\n\x1b[36m--- Starting Task: ${task_id} ---\x1b[0m`);
  
  // Reset env
  let res = await fetch(`${BASE_URL}/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_id }),
  });
  
  let obs = await res.json();
  let done = false;
  let trajectory = [];

  while (!done) {
    console.log(`Day: ${obs.day} | Weather: ${obs.weather} | Events: ${obs.events.join(", ")}`);
    
    // Call OpenAI
    // @ts-ignore
    const completion = await openai.beta.chat.completions.parse({
      model: "gpt-4o-mini", // Cost efficient model for baseline
      messages: [
        {
          role: "system",
          content: `You are an AI Campus Food Operations Manager. Your goal is to maximize fed students (+1.0), and minimize food waste/spoilage (-2.0) and shortages (-5.0).
Transfers cost -0.1 per unit.
Rules:
1. Provide exactly how much to "prep" for each hall based on 'expected_turnout' and 'inventory'.
2. If one hall has 0 inventory but positive turnout, and another hall has excess, invoke a "transfer".
3. Provide exact integer outputs. Do not over-prep.
Current Inventory and Observation:
${JSON.stringify(obs, null, 2)}`
        }
      ],
      response_format: zodResponseFormat(ActionSchema, "action_plan"),
      temperature: 0.2, // Low temp for deterministic logic
    });

    const action = completion.choices[0].message.parsed;
    console.log(`Action chosen: ${JSON.stringify(action)}`);

    // Step env
    const stepRes = await fetch(`${BASE_URL}/step`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
    });
    
    if (!stepRes.ok) {
        console.log(`Error in step:`, await stepRes.text());
        break;
    }

    const stepData = await stepRes.json();
    console.log(`Reward: ${stepData.reward} | Info: ${JSON.stringify(stepData.info)}`);
    
    trajectory.push(stepData);
    obs = stepData.observation;
    done = stepData.done;
  }

  // Grade trajectory
  const gradeRes = await fetch(`${BASE_URL}/grader`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_id, trajectory }),
  });
  
  const gradeData = await gradeRes.json();
  console.log(`\x1b[32mFinal Grader Score for ${task_id}: ${gradeData.score}\x1b[0m\n`);
}

// zodResponseFormat helper from openai
import { zodResponseFormat } from "openai/helpers/zod";

async function main() {
  const tasks = ["easy_inventory_management", "medium_multi_hall_transfer", "hard_dynamic_optimization"];
  for (const task of tasks) {
    try {
        await runTask(task);
    } catch (e) {
        console.error(`Error running task ${task}:`, e);
    }
  }
}

if (!process.env.OPENAI_API_KEY) {
    console.error("Please set OPENAI_API_KEY in .env or environment to run baseline.");
} else {
    // Basic ping to wait for server
    console.log("Ensure the server is running on port 7860 before running baseline.");
    main();
}
