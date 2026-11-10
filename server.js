const env = require('./src/config/env'); // loads .env first
const { connectDB, disconnectDB } = require('./src/config/db');
const createServer = require('./src/createServer');

async function start() {
  try {
    await connectDB(env.mongoUri);
    console.log('[db] MongoDB connected');
  } catch (err) {
    console.error(`[db] Could not connect to MongoDB: ${err.message}`);
    console.error('     Is MongoDB running? Check MONGO_URI in .env');
    process.exit(1);
  }

  const { server, io } = createServer();
  server.listen(env.port, () => {
    console.log(`[server] listening on http://localhost:${env.port}`);
    console.log(`[server] chat client: http://localhost:${env.port}/`);
  });

  const shutdown = async () => {
    io.close();
    server.close();
    await disconnectDB();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();
