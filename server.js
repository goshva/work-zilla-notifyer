require('dotenv').config();
const express = require('express');
const { fetchDashboard } = require('./src/workzillaClient');
const { findTaskGroups, guessInWorkKey, mapTask } = require('./src/taskAdapter');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

app.get('/api/tasks', async (req, res) => {
  try {
    const raw = await fetchDashboard();
    const groups = findTaskGroups(raw);
    const guessedKey = guessInWorkKey(groups);

    const mappedGroups = {};
    for (const [key, tasks] of Object.entries(groups)) {
      mappedGroups[key] = tasks.map(mapTask);
    }

    res.json({
      guessedInWorkKey: guessedKey,
      groups: mappedGroups,
      raw,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Work-Zilla Notifyer запущен: http://localhost:${PORT}`);
});
