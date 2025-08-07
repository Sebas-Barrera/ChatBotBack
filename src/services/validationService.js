const Joi = require("joi");
const logger = require("../utils/logger");
const {
  VALIDATION_PATTERNS,
  BUSINESS_CONFIG,
  FILE_LIMITS,
  ORDER_STATUS,
  CONVERSATION_STATUS,
} = require("../utils/constants");

// ============================================
// SERVICIO DE VALIDACIÓN
// ============================================

class ValidationService {
  // ============================================
  // VALIDACIONES DE RESTAURANTE
  // ============================================

  /**
   * Valida datos de creación de restaurante
   * @param {Object} data - Datos del restaurante
   * @returns {Object} Resultado de validación
   */
  static validateRestaurantCreation(data) {
    const schema = Joi.object({
      name: Joi.string().min(2).max(100).required().messages({
        "string.empty": "El nombre del restaurante es requerido",
        "string.min": "El nombre debe tener al menos 2 caracteres",
        "string.max": "El nombre no puede exceder 100 caracteres",
      }),

      slug: Joi.string().pattern(VALIDATION_PATTERNS.SLUG).required().messages({
        "string.pattern.base":
          "El slug solo puede contener letras minúsculas, números y guiones",
        "string.empty": "El slug es requerido",
      }),

      phone: Joi.string()
        .pattern(VALIDATION_PATTERNS.PHONE_NUMBER)
        .required()
        .messages({
          "string.pattern.base": "Formato de teléfono inválido",
          "string.empty": "El teléfono es requerido",
        }),

      email: Joi.string().email().optional().allow(""),

      address: Joi.string().max(255).optional().allow(""),

      logo_url: Joi.string().uri().optional().allow(""),

      opens_at: Joi.string()
        .pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/)
        .optional()
        .messages({
          "string.pattern.base": "Formato de hora inválido (HH:mm:ss)",
        }),

      closes_at: Joi.string()
        .pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/)
        .optional()
        .messages({
          "string.pattern.base": "Formato de hora inválido (HH:mm:ss)",
        }),

      delivery_time_min: Joi.number().integer().min(5).max(120).optional(),
      delivery_time_max: Joi.number().integer().min(10).max(180).optional(),
      delivery_fee: Joi.number().min(0).max(500).optional(),
      minimum_order: Joi.number().min(0).max(10000).optional(),

      whatsapp_phone_id: Joi.string().max(50).optional().allow(""),
      twilio_phone_number: Joi.string().max(20).optional().allow(""),

      // En validateRestaurantCreation agregar:
      country_code: Joi.string()
        .valid("MX", "CO", "AR", "PE", "EC", "CL", "US")
        .optional(),
      currency: Joi.string()
        .valid("MXN", "COP", "ARS", "PEN", "USD", "CLP")
        .optional(),
      timezone: Joi.string().max(50).optional(),
    });

    return this.validateWithSchema(schema, data);
  }

  /**
   * Valida actualización de restaurante
   * @param {Object} data - Datos a actualizar
   * @returns {Object} Resultado de validación
   */
  static validateRestaurantUpdate(data) {
    const schema = Joi.object({
      name: Joi.string().min(2).max(100).optional(),
      phone: Joi.string().pattern(VALIDATION_PATTERNS.PHONE_NUMBER).optional(),
      email: Joi.string().email().optional().allow(""),
      address: Joi.string().max(255).optional().allow(""),
      logo_url: Joi.string().uri().optional().allow(""),
      is_active: Joi.boolean().optional(),
      opens_at: Joi.string()
        .pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/)
        .optional(),
      closes_at: Joi.string()
        .pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/)
        .optional(),
      delivery_time_min: Joi.number().integer().min(5).max(120).optional(),
      delivery_time_max: Joi.number().integer().min(10).max(180).optional(),
      delivery_fee: Joi.number().min(0).max(500).optional(),
      minimum_order: Joi.number().min(0).max(10000).optional(),
      whatsapp_phone_id: Joi.string().max(50).optional().allow(""),
      twilio_phone_number: Joi.string().max(20).optional().allow(""),
    }).min(1);

    return this.validateWithSchema(schema, data);
  }

  // ============================================
  // VALIDACIONES DE MENÚ
  // ============================================

  /**
   * Valida creación de categoría de menú
   * @param {Object} data - Datos de la categoría
   * @returns {Object} Resultado de validación
   */
  static validateMenuCategoryCreation(data) {
    const schema = Joi.object({
      name: Joi.string().min(1).max(50).required().messages({
        "string.empty": "El nombre de la categoría es requerido",
        "string.max": "El nombre no puede exceder 50 caracteres",
      }),

      description: Joi.string().max(255).optional().allow(""),
      display_order: Joi.number().integer().min(0).optional(),
      emoji: Joi.string().max(10).optional().allow(""),
    });

    return this.validateWithSchema(schema, data);
  }

  /**
   * Valida creación de item de menú
   * @param {Object} data - Datos del item
   * @returns {Object} Resultado de validación
   */
  static validateMenuItemCreation(data) {
    const schema = Joi.object({
      category_id: Joi.string().uuid().required().messages({
        "string.empty": "La categoría es requerida",
        "string.guid": "ID de categoría inválido",
      }),

      name: Joi.string().min(1).max(100).required().messages({
        "string.empty": "El nombre del producto es requerido",
        "string.max": "El nombre no puede exceder 100 caracteres",
      }),

      description: Joi.string().max(500).optional().allow(""),

      price: Joi.number().positive().max(10000).required().messages({
        "number.positive": "El precio debe ser mayor a 0",
        "number.base": "El precio debe ser un número válido",
        "any.required": "El precio es requerido",
      }),

      preparation_time: Joi.number().integer().min(1).max(180).optional(),
      display_order: Joi.number().integer().min(0).optional(),

      ingredients: Joi.array().items(Joi.string().max(50)).max(20).optional(),
      allergens: Joi.array().items(Joi.string().max(30)).max(10).optional(),
      calories: Joi.number().integer().min(0).max(5000).optional(),

      image_url: Joi.string().uri().optional().allow(""),
    });

    return this.validateWithSchema(schema, data);
  }

  /**
   * Valida actualización de item de menú
   * @param {Object} data - Datos a actualizar
   * @returns {Object} Resultado de validación
   */
  static validateMenuItemUpdate(data) {
    const schema = Joi.object({
      category_id: Joi.string().uuid().optional(),
      name: Joi.string().min(1).max(100).optional(),
      description: Joi.string().max(500).optional().allow(""),
      price: Joi.number().positive().max(10000).optional(),
      is_available: Joi.boolean().optional(),
      preparation_time: Joi.number().integer().min(1).max(180).optional(),
      display_order: Joi.number().integer().min(0).optional(),
      ingredients: Joi.array().items(Joi.string().max(50)).max(20).optional(),
      allergens: Joi.array().items(Joi.string().max(30)).max(10).optional(),
      calories: Joi.number().integer().min(0).max(5000).optional(),
      image_url: Joi.string().uri().optional().allow(""),
    }).min(1);

    return this.validateWithSchema(schema, data);
  }

  // ============================================
  // VALIDACIONES DE PEDIDOS
  // ============================================

  /**
   * Valida datos de dirección de entrega
   * @param {Object} address - Datos de dirección
   * @returns {Object} Resultado de validación
   */
  static validateDeliveryAddress(address) {
    const schema = Joi.object({
      street: Joi.string().min(3).max(100).required().messages({
        "string.empty": "La calle es requerida",
        "string.min": "La calle debe tener al menos 3 caracteres",
      }),

      number: Joi.string().min(1).max(20).required().messages({
        "string.empty": "El número es requerido",
      }),

      neighborhood: Joi.string().min(3).max(100).required().messages({
        "string.empty": "La colonia es requerida",
        "string.min": "La colonia debe tener al menos 3 caracteres",
      }),

      references: Joi.string().max(255).optional().allow(""),
      postal_code: Joi.string()
        .pattern(VALIDATION_PATTERNS.POSTAL_CODE)
        .optional()
        .messages({
          "string.pattern.base": "Código postal inválido",
        }),
    });

    return this.validateWithSchema(schema, address);
  }

  /**
   * Valida creación de pedido
   * @param {Object} data - Datos del pedido
   * @returns {Object} Resultado de validación
   */
  static validateOrderCreation(data) {
    const schema = Joi.object({
      restaurant_id: Joi.string().uuid().required(),
      customer_phone: Joi.string()
        .pattern(VALIDATION_PATTERNS.PHONE_NUMBER)
        .required(),
      customer_name: Joi.string().max(100).optional().allow(""),

      delivery_address: Joi.object({
        street: Joi.string().min(3).max(100).required(),
        number: Joi.string().min(1).max(20).required(),
        neighborhood: Joi.string().min(3).max(100).required(),
        references: Joi.string().max(255).optional().allow(""),
        postal_code: Joi.string()
          .pattern(VALIDATION_PATTERNS.POSTAL_CODE)
          .optional(),
      }).required(),

      items: Joi.array()
        .items(
          Joi.object({
            menu_item_id: Joi.string().uuid().required(),
            name: Joi.string().max(100).required(),
            base_price: Joi.number().positive().required(),
            quantity: Joi.number().integer().min(1).max(20).required(),
            customizations: Joi.array()
              .items(
                Joi.object({
                  type: Joi.string().max(20).required(),
                  name: Joi.string().max(50).required(),
                  extra_cost: Joi.number().min(0).required(),
                })
              )
              .optional(),
            notes: Joi.string().max(255).optional().allow(""),
          })
        )
        .min(1)
        .max(BUSINESS_CONFIG.MAX_ITEMS_PER_ORDER)
        .required(),

      subtotal: Joi.number()
        .positive()
        .max(BUSINESS_CONFIG.MAX_ORDER_AMOUNT)
        .required(),
      delivery_fee: Joi.number().min(0).optional(),
      total: Joi.number()
        .positive()
        .max(BUSINESS_CONFIG.MAX_ORDER_AMOUNT)
        .required(),
      special_instructions: Joi.string().max(500).optional().allow(""),
    });

    return this.validateWithSchema(schema, data);
  }

  /**
   * Valida actualización de estado de pedido
   * @param {Object} data - Datos de actualización
   * @returns {Object} Resultado de validación
   */
  static validateOrderStatusUpdate(data) {
    const validStatuses = Object.values(ORDER_STATUS);

    const schema = Joi.object({
      status: Joi.string()
        .valid(...validStatuses)
        .required()
        .messages({
          "any.only": `Estado debe ser uno de: ${validStatuses.join(", ")}`,
        }),

      internal_notes: Joi.string().max(500).optional().allow(""),
      estimated_delivery_time: Joi.number()
        .integer()
        .min(5)
        .max(180)
        .optional(),
    });

    return this.validateWithSchema(schema, data);
  }

  // ============================================
  // VALIDACIONES DE CONVERSACIÓN
  // ============================================

  /**
   * Valida mensaje entrante
   * @param {string} message - Mensaje a validar
   * @param {Object} conversation - Conversación actual
   * @returns {Object} Resultado de validación
   */
  static validateIncomingMessage(message, conversation) {
    try {
      // Validaciones básicas
      if (!message || typeof message !== "string") {
        return {
          isValid: false,
          error: "Mensaje inválido",
        };
      }

      // Limpiar y validar longitud
      const cleanMessage = message.trim();

      if (cleanMessage.length === 0) {
        return {
          isValid: false,
          error: "Mensaje vacío",
        };
      }

      if (cleanMessage.length > 1000) {
        return {
          isValid: false,
          error: "Mensaje demasiado largo (máximo 1000 caracteres)",
        };
      }

      // Validar caracteres problemáticos
      if (this.containsMaliciousContent(cleanMessage)) {
        return {
          isValid: false,
          error: "Contenido no permitido",
        };
      }

      // Validar estado de conversación
      if (
        conversation &&
        conversation.status === CONVERSATION_STATUS.COMPLETED
      ) {
        return {
          isValid: false,
          error: "La conversación ya ha sido completada",
        };
      }

      return {
        isValid: true,
        cleanMessage,
      };
    } catch (error) {
      logger.error("Error validando mensaje entrante:", error);
      return {
        isValid: false,
        error: "Error de validación",
      };
    }
  }

  /**
   * Valida pedido desde conversación
   * @param {Object} conversation - Conversación con pedido
   * @returns {Object} Resultado de validación
   */
  static validateOrderFromConversation(conversation) {
    try {
      if (!conversation) {
        return {
          isValid: false,
          error: "Conversación no encontrada",
        };
      }

      let orderData = {};
      try {
        orderData = JSON.parse(conversation.order_data || "{}");
      } catch (e) {
        return {
          isValid: false,
          error: "Datos de pedido corruptos",
        };
      }

      // Validar items
      if (
        !orderData.items ||
        !Array.isArray(orderData.items) ||
        orderData.items.length === 0
      ) {
        return {
          isValid: false,
          error: "El pedido debe tener al menos un item",
        };
      }

      if (orderData.items.length > BUSINESS_CONFIG.MAX_ITEMS_PER_ORDER) {
        return {
          isValid: false,
          error: `Máximo ${BUSINESS_CONFIG.MAX_ITEMS_PER_ORDER} items por pedido`,
        };
      }

      // Validar dirección
      const address = orderData.delivery_address;
      if (
        !address ||
        !address.street ||
        !address.number ||
        !address.neighborhood
      ) {
        return {
          isValid: false,
          error: "Dirección de entrega incompleta",
        };
      }

      // Validar montos
      if (!orderData.total || orderData.total <= 0) {
        return {
          isValid: false,
          error: "Total del pedido inválido",
        };
      }

      if (orderData.total > BUSINESS_CONFIG.MAX_ORDER_AMOUNT) {
        return {
          isValid: false,
          error: `Monto máximo de pedido: $${BUSINESS_CONFIG.MAX_ORDER_AMOUNT}`,
        };
      }

      // Validar cada item
      for (const item of orderData.items) {
        if (
          !item.menu_item_id ||
          !item.name ||
          !item.base_price ||
          !item.quantity
        ) {
          return {
            isValid: false,
            error: "Item de pedido incompleto",
          };
        }

        if (item.quantity <= 0 || item.quantity > 20) {
          return {
            isValid: false,
            error: "Cantidad de item inválida",
          };
        }
      }

      return {
        isValid: true,
        orderData,
      };
    } catch (error) {
      logger.error("Error validando pedido desde conversación:", error);
      return {
        isValid: false,
        error: "Error de validación",
      };
    }
  }

  // ============================================
  // VALIDACIONES DE ARCHIVOS
  // ============================================

  /**
   * Valida archivo subido
   * @param {Object} file - Archivo a validar
   * @param {string} type - Tipo esperado ('image', 'document')
   * @returns {Object} Resultado de validación
   */
  static validateFileUpload(file, type = "image") {
    try {
      if (!file) {
        return {
          isValid: false,
          error: "Archivo no encontrado",
        };
      }

      // Validar tamaño
      if (file.size > FILE_LIMITS.MAX_FILE_SIZE) {
        return {
          isValid: false,
          error: `Archivo demasiado grande. Máximo: ${FILE_LIMITS.MAX_FILE_SIZE / 1024 / 1024}MB`,
        };
      }

      // Validar tipo MIME
      let allowedTypes = [];

      switch (type) {
        case "image":
          allowedTypes = FILE_LIMITS.ALLOWED_IMAGE_TYPES;
          break;
        case "document":
          allowedTypes = FILE_LIMITS.ALLOWED_DOCUMENT_TYPES;
          break;
        default:
          allowedTypes = [
            ...FILE_LIMITS.ALLOWED_IMAGE_TYPES,
            ...FILE_LIMITS.ALLOWED_DOCUMENT_TYPES,
          ];
      }

      if (!allowedTypes.includes(file.mimetype)) {
        return {
          isValid: false,
          error: `Tipo de archivo no permitido. Permitidos: ${allowedTypes.join(", ")}`,
        };
      }

      return {
        isValid: true,
        file,
      };
    } catch (error) {
      logger.error("Error validando archivo:", error);
      return {
        isValid: false,
        error: "Error de validación de archivo",
      };
    }
  }

  // ============================================
  // VALIDACIONES DE PARÁMETROS DE CONSULTA
  // ============================================

  /**
   * Valida parámetros de paginación
   * @param {Object} params - Parámetros de consulta
   * @returns {Object} Resultado de validación
   */
  static validatePaginationParams(params) {
    const schema = Joi.object({
      page: Joi.number().integer().min(1).max(1000).optional().default(1),
      limit: Joi.number().integer().min(1).max(100).optional().default(20),
      sort_by: Joi.string().max(50).optional().default("created_at"),
      sort_order: Joi.string()
        .valid("ASC", "DESC", "asc", "desc")
        .optional()
        .default("DESC"),
    });

    return this.validateWithSchema(schema, params);
  }

  /**
   * Valida parámetros de filtros de fecha
   * @param {Object} params - Parámetros de fecha
   * @returns {Object} Resultado de validación
   */
  static validateDateRangeParams(params) {
    const schema = Joi.object({
      start_date: Joi.date().iso().optional(),
      end_date: Joi.date().iso().min(Joi.ref("start_date")).optional(),
      period: Joi.string().valid("today", "week", "month", "year").optional(),
    });

    return this.validateWithSchema(schema, params);
  }

  // ============================================
  // VALIDACIONES DE WEBHOOK
  // ============================================

  /**
   * Valida datos de webhook de WhatsApp
   * @param {Object} data - Datos del webhook
   * @param {string} provider - Proveedor (twilio/meta)
   * @returns {Object} Resultado de validación
   */
  static validateWhatsAppWebhook(data, provider) {
    try {
      if (!data || typeof data !== "object") {
        return {
          isValid: false,
          error: "Datos de webhook inválidos",
        };
      }

      switch (provider.toLowerCase()) {
        case "twilio":
          return this.validateTwilioWebhook(data);
        case "meta":
          return this.validateMetaWebhook(data);
        default:
          return {
            isValid: false,
            error: "Proveedor no soportado",
          };
      }
    } catch (error) {
      logger.error("Error validando webhook de WhatsApp:", error);
      return {
        isValid: false,
        error: "Error de validación de webhook",
      };
    }
  }

  /**
   * Valida webhook de Twilio
   * @param {Object} data - Datos del webhook
   * @returns {Object} Resultado de validación
   */
  static validateTwilioWebhook(data) {
    const schema = Joi.object({
      MessageSid: Joi.string().required(),
      From: Joi.string().required(),
      To: Joi.string().required(),
      Body: Joi.string().allow("").optional(),
      MediaUrl0: Joi.string().uri().optional(),
      MediaContentType0: Joi.string().optional(),
    }).unknown(true); // Permitir campos adicionales

    return this.validateWithSchema(schema, data);
  }

  /**
   * Valida webhook de Meta
   * @param {Object} data - Datos del webhook
   * @returns {Object} Resultado de validación
   */
  static validateMetaWebhook(data) {
    const schema = Joi.object({
      entry: Joi.array()
        .items(
          Joi.object({
            changes: Joi.array()
              .items(
                Joi.object({
                  value: Joi.object({
                    messages: Joi.array()
                      .items(
                        Joi.object({
                          id: Joi.string().required(),
                          from: Joi.string().required(),
                          text: Joi.object({
                            body: Joi.string().required(),
                          }).optional(),
                          timestamp: Joi.string().required(),
                        }).unknown(true)
                      )
                      .optional(),
                    metadata: Joi.object({
                      phone_number_id: Joi.string().required(),
                    })
                      .unknown(true)
                      .required(),
                  })
                    .unknown(true)
                    .required(),
                }).unknown(true)
              )
              .required(),
          }).unknown(true)
        )
        .required(),
    }).unknown(true);

    return this.validateWithSchema(schema, data);
  }

  // ============================================
  // MÉTODOS AUXILIARES
  // ============================================

  /**
   * Ejecuta validación con esquema de Joi
   * @param {Object} schema - Esquema de Joi
   * @param {Object} data - Datos a validar
   * @returns {Object} Resultado de validación
   */
  static validateWithSchema(schema, data) {
    try {
      const { error, value } = schema.validate(data, {
        abortEarly: false, // Mostrar todos los errores
        stripUnknown: true, // Remover campos desconocidos
        convert: true, // Convertir tipos automáticamente
      });

      if (error) {
        const errorMessages = error.details.map((detail) => detail.message);

        return {
          isValid: false,
          error: errorMessages.join("; "),
          details: error.details,
        };
      }

      return {
        isValid: true,
        data: value,
      };
    } catch (validationError) {
      logger.error("Error en validación con esquema:", validationError);
      return {
        isValid: false,
        error: "Error interno de validación",
      };
    }
  }

  /**
   * Verifica si el contenido es malicioso
   * @param {string} content - Contenido a verificar
   * @returns {boolean} True si es malicioso
   */
  static containsMaliciousContent(content) {
    try {
      const maliciousPatterns = [
        /<script/i,
        /javascript:/i,
        /vbscript:/i,
        /onload=/i,
        /onerror=/i,
        /eval\(/i,
        /document\.cookie/i,
        /document\.write/i,
        /<iframe/i,
        /<object/i,
        /<embed/i,
      ];

      return maliciousPatterns.some((pattern) => pattern.test(content));
    } catch (error) {
      logger.error("Error verificando contenido malicioso:", error);
      return false; // En caso de error, permitir el contenido
    }
  }

  /**
   * Valida formato de teléfono mexicano
   * @param {string} phone - Número de teléfono
   * @returns {boolean} True si es válido
   */
  static isValidMexicanPhone(phone) {
    try {
      return VALIDATION_PATTERNS.MEXICAN_PHONE.test(phone);
    } catch (error) {
      return false;
    }
  }

  /**
   * Valida formato de email
   * @param {string} email - Email a validar
   * @returns {boolean} True si es válido
   */
  static isValidEmail(email) {
    try {
      return VALIDATION_PATTERNS.EMAIL.test(email);
    } catch (error) {
      return false;
    }
  }

  /**
   * Sanitiza texto de entrada
   * @param {string} text - Texto a sanitizar
   * @returns {string} Texto sanitizado
   */
  static sanitizeText(text) {
    if (!text || typeof text !== "string") {
      return "";
    }

    try {
      return text
        .trim()
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#x27;")
        .replace(/\//g, "&#x2F;");
    } catch (error) {
      logger.error("Error sanitizando texto:", error);
      return text;
    }
  }

  /**
   * Valida UUID
   * @param {string} uuid - UUID a validar
   * @returns {boolean} True si es válido
   */
  static isValidUUID(uuid) {
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidPattern.test(uuid);
  }
}

module.exports = ValidationService;
