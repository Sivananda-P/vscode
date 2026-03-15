# 🚀 CogniAI: Complete Run Guide

Follow these steps to get your AI-powered VS Code environment up and running.

## 📋 Prerequisites
Ensure you have your **Azure OpenAI** details ready and added to `ai-backend/.env`.

---

## 🛠️ Step 1: Start the AI Backend
The backend acts as the "brain," handling AI reasoning and code indexing.

**Terminal 1:**
```powershell
cd ai-backend
npm run dev
```
*Wait until you see: `AI Backend running on http://localhost:3000`*

---

## ⚡ Step 2: Start VS Code Watch Process
This process compiles TypeScript changes in real-time. This is essential if you modify the agent's logic.

**Terminal 2:**
```powershell
npm run watch
```
*Wait for the initial compilation to finish.*

---

## 🖥️ Step 3: Launch CogniAI (IDE)
This launches the custom VS Code instance where the CogniAI agent is active.

**Terminal 3:**
```powershell
.\scripts\code.bat
```

---

## 💡 Quick Start Script (Optional)
If you want to launch everything with a single click, you can create a file named `start-all.ps1` in the root directory with the following content:

```powershell
# Start AI Backend in a new window
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd ai-backend; npm run dev"

# Start Watch Process in a new window
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run watch"

# Launch VS Code
Write-Host "Waiting for services to initialize..." -ForegroundColor Cyan
Start-Sleep -Seconds 5
.\code.bat
```

---

## ✅ How to Verify
1. Open the newly launched VS Code.
2. Click on the **Chat Icon** in the Activity Bar.
3. Select **CogniAI** from the agent dropdown.
4. Type `/explain index.ts` and press Enter.
5. If the agent responds with code analysis, **success!** 🚀

---

> [!TIP]
> **Pro Tip:** If you haven't changed the VS Code source code recently, you can skip **Step 2** to save CPU resources. Only **Step 1** and **Step 3** are strictly mandatory for daily use.
