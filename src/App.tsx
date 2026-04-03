import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Utensils, Trash2, AlertTriangle, TrendingUp, RefreshCw, Play, Sun, Cloud, CloudRain, Calendar, Layers, BrainCircuit, Truck
} from "lucide-react";

interface Observation {
  day: number;
  current_meal: string;
  weather: string;
  events: string[];
  halls: Record<string, any>;
}

interface State {
  day: number;
  max_days: number;
  total_waste: number;
  total_shortage: number;
  total_profit: number;
  total_order_cost: number;
  history: { reward: number }[];
}

export default function App() {
  const [observation, setObservation] = useState<Observation | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [prepareAmount, setPrepareAmount] = useState<number>(100);
  const [loading, setLoading] = useState(false);
  const [isAutoPilot, setIsAutoPilot] = useState(false);
  const [lastStep, setLastStep] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [activeTask, setActiveTask] = useState<string>("easy_inventory_management");
  const [recentTransfers, setRecentTransfers] = useState<any[]>([]);

  useEffect(() => { fetchTasks(); }, []);

  useEffect(() => {
    if (tasks.length > 0) reset();
  }, [activeTask, tasks.length]);

  const fetchTasks = async () => {
    const res = await fetch("/api/tasks");
    const data = await res.json();
    setTasks(data);
  };

  const reset = async () => {
    setLoading(true);
    const res = await fetch("/api/reset", { 
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: activeTask })
    });
    const obs = await res.json();
    setObservation(obs);
    
    const stateRes = await fetch("/api/state");
    setState(await stateRes.json());
    setLastStep(null);
    setRecentTransfers([]);
    setLoading(false);
  };

  const step = async (actionOverride?: any) => {
    if (loading || (state && state.day >= state.max_days)) {
        setIsAutoPilot(false);
        return;
    }
    setLoading(true);
    
    // Default manual action (only preps standard diet at main hall to keep manual testing simple)
    const hall_id = observation && Object.keys(observation.halls)[0] ? Object.keys(observation.halls)[0] : "main_hall";
    const manualAction = { preps: { [hall_id]: { "Standard": prepareAmount, "Vegan": 0, "Gluten-Free": 0 } } };

    const payload = actionOverride || manualAction;

    const res = await fetch("/api/step", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setObservation(data.observation);
    setLastStep(data);
    
    if (payload.transfers && payload.transfers.length > 0) {
       setRecentTransfers(payload.transfers);
    } else {
       setRecentTransfers([]);
    }

    const stateRes = await fetch("/api/state");
    setState(await stateRes.json());
    setLoading(false);
  };

  const runAutoPilotStep = async () => {
    if (loading || (state && state.day >= state.max_days)) {
        setIsAutoPilot(false);
        return;
    }
    setLoading(true);
    try {
      const aiRes = await fetch("/api/ai-action");
      const action = await aiRes.json();
      await step(action);
    } catch(e) {
      console.error(e);
      setIsAutoPilot(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    let timer: any;
    if (isAutoPilot && !loading && state && state.day < state.max_days) {
      timer = setTimeout(runAutoPilotStep, 1000); // Wait 1s so judges can see the animation map!
    } else if (isAutoPilot && state && state.day >= state.max_days) {
      setIsAutoPilot(false);
    }
    return () => clearTimeout(timer);
  }, [isAutoPilot, loading, state]);

  const getWeatherIcon = (weather: string) => {
    switch (weather) {
      case "Sunny": return <Sun className="text-yellow-500 w-5 h-5" />;
      case "Rainy": return <CloudRain className="text-blue-500 w-5 h-5" />;
      case "Extreme": return <AlertTriangle className="text-rose-600 w-5 h-5 animate-pulse" />;
      default: return <Cloud className="text-gray-400 w-5 h-5" />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-900">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div>
            <h1 className="text-3xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-violet-600">
              Campus Food Waste Optimizer
            </h1>
            <p className="text-slate-500 font-medium tracking-wide text-sm mt-1">Multi-Commodity RL Logistics Environment</p>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={() => setIsAutoPilot(!isAutoPilot)}
              disabled={state && state.day >= (state as any).max_days}
              className={`flex items-center gap-2 px-5 py-2.5 text-white font-bold rounded-xl transition-all shadow-md ${
                isAutoPilot ? 'bg-rose-500 hover:bg-rose-600 ring-4 ring-rose-500/20' : 'bg-indigo-600 hover:bg-indigo-700 hover:shadow-indigo-500/30'
              } disabled:opacity-50`}
            >
              <BrainCircuit className={`w-5 h-5 ${isAutoPilot ? 'animate-pulse' : ''}`} />
              {isAutoPilot ? "STOP AUTO-PILOT" : "ACTIVATE AUTO-PILOT (AI)"}
            </button>
            <button 
              onClick={() => { setIsAutoPilot(false); reset(); }}
              className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 transition-colors shadow-sm"
            >
              <RefreshCw className={`w-5 h-5 ${loading && !isAutoPilot ? 'animate-spin' : ''}`} />
              Reset
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          
          {/* Left Column: Tasks & Controls */}
          <div className="lg:col-span-1 space-y-6">
            <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 space-y-4">
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-400">Environment Modes (Tasks)</h2>
              <div className="space-y-3">
                {tasks.map(task => (
                  <div 
                     key={task.id} 
                     onClick={() => { setIsAutoPilot(false); setActiveTask(task.id); }}
                     className={`p-4 rounded-xl transition-all cursor-pointer border-2 ${
                       activeTask === task.id ? 'border-indigo-500 bg-indigo-50 shadow-sm' : 'border-transparent bg-slate-50 hover:border-indigo-200'
                     }`}>
                    <h3 className={`font-bold ${activeTask === task.id ? 'text-indigo-700' : 'text-slate-700'}`}>{task.name}</h3>
                    <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{task.description}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Environmental Mechanics (Weather & Events) */}
            <section className="bg-gradient-to-br from-slate-900 to-indigo-950 p-6 rounded-2xl shadow-md text-white space-y-5">
              <div className="flex justify-between items-center">
                 <h2 className="text-xs font-black uppercase tracking-widest text-indigo-300">World State</h2>
                 {observation && <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-bold font-mono">Day {observation.day || 0}</span>}
              </div>
              {observation && (
                <div className="space-y-4">
                  <div className="flex items-center gap-4 bg-white/5 p-3 rounded-xl border border-white/10">
                    <div className="p-2 bg-white/10 rounded-lg backdrop-blur-sm">
                      {getWeatherIcon(observation.weather || "Normal")}
                    </div>
                    <div>
                      <p className="text-[10px] text-indigo-200 font-bold uppercase tracking-wider">Forecast</p>
                      <p className="font-semibold text-white tracking-wide">{observation.weather || "Normal"}</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                     <p className="text-[10px] text-indigo-200 font-bold uppercase tracking-wider">Active Campus Events</p>
                     <div className="flex flex-wrap gap-2">
                        {!(observation.events?.length > 0) ? (
                           <span className="text-xs text-indigo-300/50 italic">Normal Operations</span>
                        ) : observation.events.map((e, idx) => (
                           <span key={idx} className="px-2.5 py-1 bg-rose-500/20 border border-rose-500/50 text-rose-300 text-xs font-bold rounded-lg shadow-[0_0_10px_rgba(244,63,94,0.2)]">
                              {e}
                           </span>
                        ))}
                     </div>
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* Right Column: Visual MAP and Metrics */}
          <div className="lg:col-span-3 space-y-6">
            
            {/* The Spatial Campus Map Visualization */}
            <section className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100 min-h-[350px] relative overflow-hidden">
               <h2 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-6">Campus Logistics Map</h2>
               
               {/* Animated Transfers Overlay */}
               <AnimatePresence>
                 {(recentTransfers || []).map((t, idx) => (
                    <motion.div 
                       key={idx + Math.random()} 
                       initial={{ opacity: 0, scale: 0.8, y: 10 }}
                       animate={{ opacity: 1, scale: 1, y: 0 }}
                       exit={{ opacity: 0, y: -20 }}
                       className="absolute top-8 left-1/2 -translate-x-1/2 z-20 px-6 py-2 bg-indigo-600 text-white font-bold rounded-full shadow-lg flex items-center gap-3 border border-indigo-400"
                    >
                       <Truck className="w-5 h-5 animate-bounce" />
                       Moved {t.quantity} <span className="font-medium opacity-80">{t.diet}</span> from {t.from_hall} to {t.to_hall}
                    </motion.div>
                 ))}
               </AnimatePresence>

               {observation && (
                 <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative z-10">
                    {Object.entries(observation.halls || {}).map(([hall_id, hall_data]: [string, any]) => (
                       <div key={hall_id} className="relative bg-slate-50 border-2 border-slate-100 rounded-2xl p-5 hover:border-indigo-200 transition-colors">
                          <h3 className="font-black text-lg text-slate-800 capitalize tracking-tight border-b border-slate-200 pb-3 mb-3 shrink-0">
                             {hall_id.replace("_", " ")}
                          </h3>
                          
                          {/* Diet Inventory Tracking */}
                           <div className="space-y-3">
                             <div className="flex justify-between items-center text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">
                               <span>Diet Typology</span>
                               <span>Stock reserve</span>
                             </div>
                             
                             <div className="flex items-center justify-between p-2 bg-white rounded-lg border border-slate-100 shadow-sm">
                                <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5"><div className="w-2 h-2 bg-amber-400 rounded-full"></div>Standard</span>
                                <span className="font-mono font-bold text-indigo-600">{hall_data?.inventory_totals?.["Standard"] || 0}</span>
                             </div>
                             <div className="flex items-center justify-between p-2 bg-white rounded-lg border border-slate-100 shadow-sm">
                                <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5"><div className="w-2 h-2 bg-emerald-400 rounded-full"></div>Vegan</span>
                                <span className="font-mono font-bold text-emerald-600">{hall_data?.inventory_totals?.["Vegan"] || 0}</span>
                             </div>
                             <div className="flex items-center justify-between p-2 bg-white rounded-lg border border-slate-100 shadow-sm">
                                <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5"><div className="w-2 h-2 bg-blue-400 rounded-full"></div>Gluten-Free</span>
                                <span className="font-mono font-bold text-blue-600">{hall_data?.inventory_totals?.["Gluten-Free"] || 0}</span>
                             </div>

                             {hall_data?.incoming_orders?.length > 0 && (
                                <div className="mt-4 p-2 bg-rose-50 border border-rose-100 rounded-lg">
                                   <p className="text-[10px] font-bold text-rose-600 uppercase flex items-center gap-1 mb-1"><Layers className="w-3 h-3"/> Pending Inbound Orders</p>
                                   <div className="space-y-1">
                                      {hall_data.incoming_orders.map((o: any, i: number) => (
                                         <div key={i} className="flex justify-between text-[10px] text-rose-800">
                                            <span>{o.quantity}x {o.diet}</span>
                                            <span className="font-bold">in {(o.arrival_day || 0) - (observation.day || 0)} days</span>
                                         </div>
                                      ))}
                                   </div>
                                </div>
                             )}
                          </div>
                       </div>
                    ))}
                 </div>
               )}
            </section>

            {/* Metrics Dashboard */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                  <TrendingUp className="w-16 h-16 text-emerald-600" />
                </div>
                <div className="space-y-1 relative z-10">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Profit</span>
                  <div className="text-2xl font-black text-slate-900 tracking-tight">
                    ${(state?.total_profit || 0).toLocaleString()}
                  </div>
                  <p className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">Net earnings (Reward)</p>
                </div>
              </div>

              <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                  <Trash2 className="w-16 h-16 text-rose-600" />
                </div>
                <div className="space-y-1 relative z-10">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Wasted / Spoiled</span>
                  <div className="text-2xl font-black text-slate-900 tracking-tight">
                    {(state?.total_waste || 0) + (state?.total_spoiled || 0)} <span className="text-xs font-normal text-slate-400">units</span>
                  </div>
                  <p className="text-[10px] text-rose-500 font-bold flex items-center gap-1">Destroyed revenue</p>
                </div>
              </div>

              <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                  <AlertTriangle className="w-16 h-16 text-orange-600" />
                </div>
                <div className="space-y-1 relative z-10">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Hungry Students</span>
                  <div className="text-2xl font-black text-slate-900 tracking-tight">
                    {state?.total_shortage} <span className="text-xs font-normal text-slate-400">units</span>
                  </div>
                  <p className="text-[10px] text-orange-600 font-bold flex items-center gap-1">Total Stockouts</p>
                </div>
              </div>

              <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                  <Layers className="w-16 h-16 text-indigo-600" />
                </div>
                <div className="space-y-1 relative z-10">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Order Sink</span>
                  <div className="text-2xl font-black text-slate-900 tracking-tight">
                    ${(state?.total_order_cost || 0).toLocaleString()}
                  </div>
                  <p className="text-[10px] text-indigo-500 font-bold flex items-center gap-1">Spent on Lead Times</p>
                </div>
              </div>
            </div>

            {/* Manual Controls (Minimized for AI Hackathon focus) */}
            <section className="bg-slate-100 p-6 rounded-2xl border border-slate-200">
               <div className="flex gap-4 items-center max-w-xl">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">Manual Standard Prep:</h3>
                  <input 
                    type="number" 
                    value={prepareAmount}
                    onChange={(e) => setPrepareAmount(parseInt(e.target.value))}
                    disabled={isAutoPilot}
                    className="flex-1 px-4 py-2.5 border border-white rounded-xl shadow-inner focus:ring-2 focus:ring-indigo-500 outline-none font-mono font-bold"
                  />
                  <button 
                    onClick={() => step()}
                    disabled={loading || isAutoPilot || (state && state.day >= (state as any).max_days)}
                    className="px-6 py-2.5 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 disabled:opacity-50 transition-all shadow-md"
                  >
                    Manual Step
                  </button>
               </div>
            </section>

          </div>
        </div>
      </div>
    </div>
  );
}
