import express from "express";

const app = express();
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.post("/api/auth/login", (_req, res) => {
  res.status(503).json({ error: "Sistema em manutenção. Tente em 5 minutos." });
});

export default app;
