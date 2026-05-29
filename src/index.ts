import Fastify from "fastify";
import cors from "@fastify/cors"
import helmet from "@fastify/helmet";
import { dotENV } from "./config/dotEnv.js";



const app = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname'
      }
    }
  }
})


// Plugins
await app.register(cors, { origin: true })
await app.register(helmet)



// Health check
app.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() }
})

// Start server
const start = async () => {
  try {
    const port = Number(dotENV.PORT) || 4000
    await app.listen({ port, host: '0.0.0.0' })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()