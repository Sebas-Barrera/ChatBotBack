const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const cron = require("node-cron");
require("dotenv").config();

// Importar configuración y servicios
const logger = require("./src/utils/logger");
const { errorHandler } = require('./src/middleware/errorHandler');
const rateLimiter = require("./src/middleware/rateLimiter");
const { testDatabaseConnection } = require("./src/config/database");
const {
  cleanupInactiveConversations,
} = require("./src/services/conversationService");

// Importar rutas
const webhookRoutes = require("./src/routes/webhook");
const restaurantRoutes = require("./src/routes/restaurants");
const menuRoutes = require("./src/routes/menu");
const orderRoutes = require("./src/routes/orders");
const dashboardRoutes = require("./src/routes/dashboard");

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "localhost";
let server;

// ============================================
// MIDDLEWARE GLOBAL
// ============================================

// Seguridad
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
  })
);

// CORS configurado
app.use(
  cors({
    origin: process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : true,
    credentials: true,
    optionsSuccessStatus: 200,
  })
);

// Compresión
app.use(compression());

// Rate limiting
app.use("/api/", rateLimiter.apiLimiter);

// Parsing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Logging de requests
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.originalUrl}`, {
    ip: req.ip,
    userAgent: req.get("User-Agent"),
    timestamp: new Date().toISOString(),
  });
  next();
});

// ============================================
// RUTAS
// ============================================

// Health check
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    version: require("./package.json").version,
  });
});

// Webhook de WhatsApp (sin rate limit para no bloquear mensajes)
app.use("/webhook", webhookRoutes);

// API Routes (con rate limit)
app.use("/api/restaurants", restaurantRoutes);
app.use("/api/menu", menuRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use('/api/auth', require('./src/routes/auth'));

// Ruta de prueba
app.get("/", (req, res) => {
  res.json({
    message: "ChatBot Chingón API v1.0",
    status: "running",
    docs: "/api/docs",
    health: "/health",
  });
});

// ============================================
// MANEJO DE ERRORES
// ============================================

// 404 Handler
app.use("*", (req, res) => {
  logger.warn(`404 - Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    success: false,
    message: "Ruta no encontrada",
    path: req.originalUrl,
  });
});

// Global error handler
app.use(errorHandler);

// ============================================
// TAREAS PROGRAMADAS
// ============================================

// Limpiar conversaciones inactivas cada hora
cron.schedule("0 * * * *", async () => {
  try {
    logger.info("Ejecutando limpieza de conversaciones inactivas...");
    const cleanedCount = await cleanupInactiveConversations();
    logger.info(
      `Limpieza completada: ${cleanedCount} conversaciones marcadas como abandonadas`
    );
  } catch (error) {
    logger.error("Error en limpieza de conversaciones:", error);
  }
});

// ============================================
// MANEJO DE SEÑALES DEL SISTEMA
// ============================================

// Graceful shutdown
const gracefulShutdown = (signal) => {
  logger.info(`Recibida señal ${signal}. Cerrando servidor...`);

  if (server) {
    server.close(() => {
      logger.info("Servidor HTTP cerrado.");

      // Cerrar conexiones de base de datos
      const { pool } = require("./src/config/database");
      pool.end(() => {
        logger.info("Pool de base de datos cerrado.");
        process.exit(0);
      });
    });
  } else {
    logger.info("Servidor no iniciado, cerrando proceso...");
    process.exit(0);
  }

  server.close(() => {
    logger.info("Servidor HTTP cerrado.");

    // Cerrar conexiones de base de datos
    const { pool } = require("./src/config/database");
    pool.end(() => {
      logger.info("Pool de base de datos cerrado.");
      process.exit(0);
    });
  });

  // Forzar cierre después de 10 segundos
  setTimeout(() => {
    logger.error("Forzando cierre del servidor...");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Manejo de errores no capturados
process.on("uncaughtException", (error) => {
  logger.error("Excepción no capturada:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Promise rechazada no manejada:", { reason, promise });
  process.exit(1);
});

// ============================================
// INICIALIZACIÓN DEL SERVIDOR
// ============================================

const startServer = async () => {
  try {
    // Verificar conexión a base de datos
    logger.info("Verificando conexión a base de datos...");
    await testDatabaseConnection();
    logger.info("✅ Conexión a base de datos exitosa");

    // Iniciar servidor y asignar a la variable global
    server = app.listen(PORT, HOST, () => {
      logger.info(`🚀 Servidor ChatBot Chingón iniciado`);
      logger.info(`📍 URL: http://${HOST}:${PORT}`);
      logger.info(`🌍 Entorno: ${process.env.NODE_ENV}`);
      logger.info(`📋 Health Check: http://${HOST}:${PORT}/health`);

      if (process.env.NODE_ENV === "development") {
        logger.info(
          `🔗 Frontend: ${process.env.FRONTEND_URL || "No configurado"}`
        );
        logger.info(`📞 WhatsApp Webhook: http://${HOST}:${PORT}/webhook`);
      }
    });

    // Configurar timeout del servidor
    server.timeout = 30000; // 30 segundos

    return server;
  } catch (error) {
    logger.error("❌ Error al iniciar el servidor:", error);
    process.exit(1);
  }
};

// Exportar para tests
if (require.main === module) {
  // Solo ejecutar si es llamado directamente
  startServer();
} else {
  // Para tests
  module.exports = app;
}
