const { query, transaction } = require("../config/database");
const logger = require("../utils/logger");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcryptjs");
const {
  ValidationError,
  DatabaseError,
  NotFoundError,
} = require("../middleware/errorHandler");

// ============================================
// MODELO RESTAURANT
// ============================================

class Restaurant {
  /**
   * Crea un nuevo restaurante
   * @param {Object} restaurantData - Datos del restaurante
   * @returns {Promise<Object>} Restaurante creado
   */
  static async create(restaurantData) {
    const {
      name,
      slug,
      phone,
      email,
      address,
      logo_url,
      country_code = "MX", // NUEVO
      currency = "MXN", // NUEVO
      timezone = "America/Mexico_City", // NUEVO
      opens_at = "09:00:00",
      closes_at = "23:00:00",
      delivery_time_min = 25,
      delivery_time_max = 35,
      delivery_fee = 0.0,
      minimum_order = 0.0,
      whatsapp_phone_id,
      twilio_phone_number,
    } = restaurantData;

    // Validaciones básicas
    if (!name || !slug || !phone) {
      throw new ValidationError("Nombre, slug y teléfono son requeridos");
    }

    try {
      return await transaction(async (client) => {
        // Crear restaurante
        const restaurantResult = await client.query(
          `INSERT INTO restaurants (
    id, name, slug, phone, email, address, logo_url,
    country_code, currency, timezone,
    opens_at, closes_at, delivery_time_min, delivery_time_max,
    delivery_fee, minimum_order, whatsapp_phone_id, twilio_phone_number
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
  RETURNING *`,
          [
            uuidv4(),
            name,
            slug,
            phone,
            email,
            address,
            logo_url,
            country_code,
            currency,
            timezone,
            opens_at,
            closes_at,
            delivery_time_min,
            delivery_time_max,
            delivery_fee,
            minimum_order,
            whatsapp_phone_id,
            twilio_phone_number,
          ]
        );

        const restaurant = restaurantResult.rows[0];

        // Crear configuración por defecto
        await client.query(
          `INSERT INTO restaurant_settings (
            id, restaurant_id, ai_personality, welcome_message, goodbye_message, error_message
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            uuidv4(),
            restaurant.id,
            "Amigable y servicial",
            `¡Hola! 👋 Bienvenido a ${name}. ¿En qué puedo ayudarte hoy?`,
            "¡Gracias por tu pedido! 🙏 Te esperamos pronto.",
            "Lo siento, tuve un problema técnico. ¿Podrías repetir tu mensaje?",
          ]
        );

        logger.info("Restaurante creado exitosamente", {
          restaurantId: restaurant.id,
          name: restaurant.name,
          slug: restaurant.slug,
        });

        return restaurant;
      });
    } catch (error) {
      if (error.code === "23505") {
        // unique violation
        if (error.constraint === "restaurants_slug_key") {
          throw new ValidationError("El slug ya está en uso");
        }
        if (error.constraint === "restaurants_phone_key") {
          throw new ValidationError("El teléfono ya está registrado");
        }
      }

      logger.error("Error creando restaurante:", error);
      throw new DatabaseError("Error al crear restaurante", error);
    }
  }

  /**
   * Obtiene un restaurante por ID
   * @param {string} id - ID del restaurante
   * @returns {Promise<Object|null>} Datos del restaurante
   */
  static async findById(id) {
    try {
      const result = await query(
        `SELECT 
          r.*,
          rs.claude_api_key,
          rs.claude_model,
          rs.ai_personality,
          rs.welcome_message,
          rs.goodbye_message,
          rs.error_message,
          rs.auto_confirm_orders,
          rs.max_conversation_time,
          rs.notification_email,
          rs.notification_phone
        FROM restaurants r
        LEFT JOIN restaurant_settings rs ON r.id = rs.restaurant_id
        WHERE r.id = $1`,
        [id],
        "find_restaurant_by_id"
      );

      return result.rows[0] || null;
    } catch (error) {
      logger.error("Error obteniendo restaurante por ID:", error);
      throw new DatabaseError("Error al obtener restaurante", error);
    }
  }

  /**
   * Obtiene un restaurante por slug
   * @param {string} slug - Slug del restaurante
   * @returns {Promise<Object|null>} Datos del restaurante
   */
  static async findBySlug(slug) {
    try {
      const result = await query(
        `SELECT 
          r.*,
          rs.claude_api_key,
          rs.claude_model,
          rs.ai_personality,
          rs.welcome_message,
          rs.goodbye_message,
          rs.error_message,
          rs.auto_confirm_orders,
          rs.max_conversation_time,
          rs.notification_email,
          rs.notification_phone
        FROM restaurants r
        LEFT JOIN restaurant_settings rs ON r.id = rs.restaurant_id
        WHERE r.slug = $1`,
        [slug],
        "find_restaurant_by_slug"
      );

      return result.rows[0] || null;
    } catch (error) {
      logger.error("Error obteniendo restaurante por slug:", error);
      throw new DatabaseError("Error al obtener restaurante", error);
    }
  }

  /**
   * Obtiene un restaurante por teléfono
   * @param {string} phone - Teléfono del restaurante
   * @returns {Promise<Object|null>} Datos del restaurante
   */
  static async findByPhone(phone) {
    try {
      const result = await query(
        `SELECT 
          r.*,
          rs.claude_api_key,
          rs.claude_model,
          rs.ai_personality,
          rs.welcome_message,
          rs.goodbye_message,
          rs.error_message
        FROM restaurants r
        LEFT JOIN restaurant_settings rs ON r.id = rs.restaurant_id
        WHERE r.phone = $1 OR r.twilio_phone_number = $1`,
        [phone],
        "find_restaurant_by_phone"
      );

      return result.rows[0] || null;
    } catch (error) {
      logger.error("Error obteniendo restaurante por teléfono:", error);
      throw new DatabaseError("Error al obtener restaurante", error);
    }
  }

  /**
   * Actualiza un restaurante
   * @param {string} id - ID del restaurante
   * @param {Object} updateData - Datos a actualizar
   * @returns {Promise<Object>} Restaurante actualizado
   */
  static async update(id, updateData) {
    const allowedFields = [
      "name",
      "phone",
      "email",
      "address",
      "logo_url",
      "is_active",
      "opens_at",
      "closes_at",
      "delivery_time_min",
      "delivery_time_max",
      "delivery_fee",
      "minimum_order",
      "whatsapp_phone_id",
      "twilio_phone_number",
      "country_code",
      "currency",
      "timezone",
    ];

    const fields = [];
    const values = [];
    let paramCount = 1;

    // Construir query dinámicamente
    Object.keys(updateData).forEach((key) => {
      if (allowedFields.includes(key) && updateData[key] !== undefined) {
        fields.push(`${key} = $${paramCount}`);
        values.push(updateData[key]);
        paramCount++;
      }
    });

    if (fields.length === 0) {
      throw new ValidationError("No hay campos válidos para actualizar");
    }

    values.push(id); // ID va al final

    try {
      const result = await query(
        `UPDATE restaurants 
         SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP
         WHERE id = $${paramCount}
         RETURNING *`,
        values,
        "update_restaurant"
      );

      if (result.rows.length === 0) {
        throw new NotFoundError("Restaurante");
      }

      logger.info("Restaurante actualizado", {
        restaurantId: id,
        updatedFields: Object.keys(updateData),
      });

      return result.rows[0];
    } catch (error) {
      if (error.code === "23505") {
        // unique violation
        if (error.constraint === "restaurants_phone_key") {
          throw new ValidationError("El teléfono ya está registrado");
        }
      }

      logger.error("Error actualizando restaurante:", error);
      throw new DatabaseError("Error al actualizar restaurante", error);
    }
  }

  /**
   * Actualiza configuración del restaurante
   * @param {string} restaurantId - ID del restaurante
   * @param {Object} settingsData - Configuración a actualizar
   * @returns {Promise<Object>} Configuración actualizada
   */
  static async updateSettings(restaurantId, settingsData) {
    const allowedFields = [
      "claude_api_key",
      "claude_model",
      "ai_personality",
      "welcome_message",
      "goodbye_message",
      "error_message",
      "auto_confirm_orders",
      "require_phone_validation",
      "max_conversation_time",
      "notification_email",
      "notification_phone",
    ];

    const fields = [];
    const values = [];
    let paramCount = 1;

    Object.keys(settingsData).forEach((key) => {
      if (allowedFields.includes(key) && settingsData[key] !== undefined) {
        fields.push(`${key} = $${paramCount}`);
        values.push(settingsData[key]);
        paramCount++;
      }
    });

    if (fields.length === 0) {
      throw new ValidationError("No hay campos válidos para actualizar");
    }

    values.push(restaurantId);

    try {
      // Verificar si existe configuración
      const existsResult = await query(
        "SELECT id FROM restaurant_settings WHERE restaurant_id = $1",
        [restaurantId],
        "check_restaurant_settings_exists"
      );

      let result;

      if (existsResult.rows.length > 0) {
        // Actualizar existente
        result = await query(
          `UPDATE restaurant_settings 
           SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP
           WHERE restaurant_id = $${paramCount}
           RETURNING *`,
          values,
          "update_restaurant_settings"
        );
      } else {
        // Crear nueva configuración
        const insertFields = [
          "id",
          "restaurant_id",
          ...Object.keys(settingsData),
        ];
        const insertValues = [
          uuidv4(),
          restaurantId,
          ...Object.values(settingsData),
        ];
        const placeholders = insertValues.map((_, i) => `$${i + 1}`).join(", ");

        result = await query(
          `INSERT INTO restaurant_settings (${insertFields.join(", ")})
           VALUES (${placeholders})
           RETURNING *`,
          insertValues,
          "create_restaurant_settings"
        );
      }

      logger.info("Configuración de restaurante actualizada", {
        restaurantId,
        updatedFields: Object.keys(settingsData),
      });

      return result.rows[0];
    } catch (error) {
      logger.error("Error actualizando configuración de restaurante:", error);
      throw new DatabaseError("Error al actualizar configuración", error);
    }
  }

  /**
   * Obtiene lista de restaurantes con paginación
   * @param {Object} options - Opciones de consulta
   * @returns {Promise<Object>} Lista paginada de restaurantes
   */
  static async findAll(options = {}) {
    const {
      page = 1,
      limit = 10,
      search = "",
      isActive = null,
      sortBy = "created_at",
      sortOrder = "DESC",
    } = options;

    const offset = (page - 1) * limit;
    const validSortFields = ["name", "created_at", "updated_at"];
    const validSortOrders = ["ASC", "DESC"];

    if (!validSortFields.includes(sortBy)) {
      throw new ValidationError("Campo de ordenamiento inválido");
    }

    if (!validSortOrders.includes(sortOrder.toUpperCase())) {
      throw new ValidationError("Orden de ordenamiento inválido");
    }

    try {
      // Construir WHERE clause
      const conditions = [];
      const values = [];
      let paramCount = 1;

      if (search) {
        conditions.push(
          `(r.name ILIKE $${paramCount} OR r.slug ILIKE $${paramCount})`
        );
        values.push(`%${search}%`);
        paramCount++;
      }

      if (isActive !== null) {
        conditions.push(`r.is_active = $${paramCount}`);
        values.push(isActive);
        paramCount++;
      }

      const whereClause =
        conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

      // Consulta principal
      const restaurantsResult = await query(
        `SELECT 
          r.id, r.name, r.slug, r.phone, r.email, r.is_active,
          r.opens_at, r.closes_at, r.created_at, r.updated_at,
          COUNT(o.id) as total_orders,
          COALESCE(SUM(o.total), 0) as total_revenue
        FROM restaurants r
        LEFT JOIN orders o ON r.id = o.restaurant_id
        ${whereClause}
        GROUP BY r.id
        ORDER BY r.${sortBy} ${sortOrder.toUpperCase()}
        LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
        [...values, limit, offset],
        "find_all_restaurants"
      );

      // Contar total
      const countResult = await query(
        `SELECT COUNT(*) as total FROM restaurants r ${whereClause}`,
        values.slice(0, -2), // Remover limit y offset
        "count_all_restaurants"
      );

      const total = parseInt(countResult.rows[0].total);
      const totalPages = Math.ceil(total / limit);

      return {
        restaurants: restaurantsResult.rows,
        pagination: {
          current_page: page,
          total_pages: totalPages,
          total_items: total,
          items_per_page: limit,
          has_next: page < totalPages,
          has_prev: page > 1,
        },
      };
    } catch (error) {
      logger.error("Error obteniendo lista de restaurantes:", error);
      throw new DatabaseError("Error al obtener restaurantes", error);
    }
  }

  /**
   * Desactiva un restaurante (soft delete)
   * @param {string} id - ID del restaurante
   * @returns {Promise<boolean>} True si se desactivó correctamente
   */
  static async deactivate(id) {
    try {
      const result = await query(
        "UPDATE restaurants SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id",
        [id],
        "deactivate_restaurant"
      );

      if (result.rows.length === 0) {
        throw new NotFoundError("Restaurante");
      }

      logger.info("Restaurante desactivado", { restaurantId: id });
      return true;
    } catch (error) {
      logger.error("Error desactivando restaurante:", error);
      throw new DatabaseError("Error al desactivar restaurante", error);
    }
  }

  /**
   * Activa un restaurante
   * @param {string} id - ID del restaurante
   * @returns {Promise<boolean>} True si se activó correctamente
   */
  static async activate(id) {
    try {
      const result = await query(
        "UPDATE restaurants SET is_active = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id",
        [id],
        "activate_restaurant"
      );

      if (result.rows.length === 0) {
        throw new NotFoundError("Restaurante");
      }

      logger.info("Restaurante activado", { restaurantId: id });
      return true;
    } catch (error) {
      logger.error("Error activando restaurante:", error);
      throw new DatabaseError("Error al activar restaurante", error);
    }
  }

  /**
   * Obtiene estadísticas básicas de un restaurante
   * @param {string} restaurantId - ID del restaurante
   * @param {Object} dateRange - Rango de fechas
   * @returns {Promise<Object>} Estadísticas del restaurante
   */
  static async getStats(restaurantId, dateRange = {}) {
    const { startDate, endDate } = dateRange;

    try {
      let dateCondition = "";
      const values = [restaurantId];

      if (startDate && endDate) {
        dateCondition = "AND o.created_at BETWEEN $2 AND $3";
        values.push(startDate, endDate);
      }

      const result = await query(
        `SELECT 
          COUNT(DISTINCT o.id) as total_orders,
          COUNT(DISTINCT o.customer_phone) as unique_customers,
          COALESCE(SUM(o.total), 0) as total_revenue,
          COALESCE(AVG(o.total), 0) as average_order_value,
          COUNT(CASE WHEN o.status = 'delivered' THEN 1 END) as delivered_orders,
          COUNT(CASE WHEN o.status = 'cancelled' THEN 1 END) as cancelled_orders,
          COUNT(DISTINCT c.id) as total_conversations,
          COUNT(CASE WHEN c.status = 'completed' THEN 1 END) as completed_conversations
        FROM orders o
        LEFT JOIN conversations c ON o.restaurant_id = c.restaurant_id
        WHERE o.restaurant_id = $1 ${dateCondition}`,
        values,
        "get_restaurant_stats"
      );

      const stats = result.rows[0];

      // Calcular tasas
      stats.completion_rate =
        stats.total_orders > 0
          ? ((stats.delivered_orders / stats.total_orders) * 100).toFixed(2)
          : 0;

      stats.cancellation_rate =
        stats.total_orders > 0
          ? ((stats.cancelled_orders / stats.total_orders) * 100).toFixed(2)
          : 0;

      stats.conversion_rate =
        stats.total_conversations > 0
          ? (
              (stats.completed_conversations / stats.total_conversations) *
              100
            ).toFixed(2)
          : 0;

      return stats;
    } catch (error) {
      logger.error("Error obteniendo estadísticas de restaurante:", error);
      throw new DatabaseError("Error al obtener estadísticas", error);
    }
  }

  /**
   * Verifica si un slug está disponible
   * @param {string} slug - Slug a verificar
   * @param {string} excludeId - ID a excluir de la verificación
   * @returns {Promise<boolean>} True si está disponible
   */
  static async isSlugAvailable(slug, excludeId = null) {
    try {
      let queryText = "SELECT id FROM restaurants WHERE slug = $1";
      const values = [slug];

      if (excludeId) {
        queryText += " AND id != $2";
        values.push(excludeId);
      }

      const result = await query(queryText, values, "check_slug_availability");
      return result.rows.length === 0;
    } catch (error) {
      logger.error("Error verificando disponibilidad de slug:", error);
      throw new DatabaseError("Error al verificar slug", error);
    }
  }
}

module.exports = Restaurant;
