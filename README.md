# Campus Food Waste RL Optimizer

This project is an RL environment simulating a university's campus food service operations. The agent acts as the Campus Food Operations Manager, solving complex supply chain and inventory logistics to ensure students are fed while minimizing food waste.

## Overview

University dining halls generate massive amounts of organic waste due to unpredictable student footfall, rigid supply chains, and separated inventory silos (different dining halls). The agent must monitor inventory expiring, transfer food across the campus to locations with shortages, and adjust precise preps to mitigate spoilage and stockouts.

## OpenEnv Spec

The environment strictly adheres to the OpenEnv standard using HTTP REST endpoints.

**Observation Space (State)**:
- `day`, `weather`, `events`: External noise variables driving student turnout (e.g. Football games, Rain).
- `halls`: A dictionary defining each dining hall's current raw food `inventory` (including expiry dates) and expected baseline turnout.

**Action Space (Action)**:
- `preps`: Number of meals to prep per dining hall from raw inventory.
- `transfers`: Move ingredients between halls to avoid spoilage.
- `orders`: Order more stock with a 1-day lead time.

**Tasks**:
1. `easy_inventory_management`: Basic 1-hall prep optimization.
2. `medium_multi_hall_transfer`: Identify expiring stock in Hall A and transfer to Hall B to prevent spoilage.
3. `hard_dynamic_optimization`: Multi-day logistics with shifting weather and events.

## Deployment (Hugging Face Spaces)

This repository includes a `Dockerfile` optimized for HF Spaces.
1. Push to a Hugging Face Space using the `Docker` template.
2. The server exposes the OpenEnv endpoints on port `7860`.

## Baseline Inference

A baseline inference script `baseline.ts` using the OpenAI API SDK demonstrates how to solve the tasks with structured output schemas matching the environment actions.

1. `npm install`
2. `export OPENAI_API_KEY="your-key-here"`
3. Start the server: `npm run dev`
4. Run baseline: `npm run baseline`
