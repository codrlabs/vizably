/**
 * Server entry point. Builds the app via the composition root and
 * binds it to the configured port.
 */
require('dotenv').config();

if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is required');
}
if (!process.env.ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY is required');
}

const { buildApp } = require('./app');

const PORT = process.env.PORT || 3000;

const app = buildApp();

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
