import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './src/db.js';
import { createApp } from './src/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3003;

const repo = openDatabase(process.env.DB_FILE || path.join(__dirname, 'data', 'restaurant.db'));

createApp(repo).listen(PORT, () => {
  console.log(`VR-меню ресторану запущено: http://localhost:${PORT}`);
});
