// Vercel serverless entry point. All /api/* requests are rewritten here
// (see vercel.json) and handled by the Express app.
import { buildApp } from '../server/src/bootstrap.js';

export default buildApp();
