const twilio = require('twilio');
const axios = require('axios');
const logger = require('../utils/logger');

// ============================================
// CONFIGURACIÓN DE TWILIO WHATSAPP
// ============================================

const twilioConfig = {
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN,
  phoneNumber: process.env.TWILIO_PHONE_NUMBER,
};

// Configuración de Meta WhatsApp Business API
const metaConfig = {
  accessToken: process.env.META_WHATSAPP_TOKEN,
  phoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID,
  verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN,
  apiVersion: 'v18.0',
  baseUrl: 'https://graph.facebook.com'
};

// Inicializar cliente de Twilio si está configurado
let twilioClient = null;

if (twilioConfig.accountSid && twilioConfig.authToken) {
  twilioClient = twilio(twilioConfig.accountSid, twilioConfig.authToken);
  logger.info('✅ Cliente Twilio inicializado');
}

// ============================================
// UTILIDADES DE FORMATEO
// ============================================

/**
 * Formatea un número de teléfono a formato internacional
 * @param {string} phoneNumber - Número de teléfono
 * @returns {string} Número formateado
 */
const formatPhoneNumber = (phoneNumber) => {
  // Remover espacios, guiones y paréntesis
  let cleaned = phoneNumber.replace(/[\s\-\(\)]/g, '');
  
  // Si no empieza con +, agregar código de país de México
  if (!cleaned.startsWith('+')) {
    if (cleaned.startsWith('52')) {
      cleaned = '+' + cleaned;
    } else if (cleaned.length === 10) {
      cleaned = '+52' + cleaned;
    } else {
      cleaned = '+' + cleaned;
    }
  }
  
  return cleaned;
};

/**
 * Valida si un número de WhatsApp es válido
 * @param {string} phoneNumber - Número a validar
 * @returns {boolean} True si es válido
 */
const isValidWhatsAppNumber = (phoneNumber) => {
  const formatted = formatPhoneNumber(phoneNumber);
  const whatsappRegex = /^\+[1-9]\d{1,14}$/;
  return whatsappRegex.test(formatted);
};

// ============================================
// FUNCIONES DE TWILIO WHATSAPP
// ============================================

/**
 * Envía un mensaje via Twilio WhatsApp
 * @param {string} to - Número de teléfono destino
 * @param {string} message - Mensaje a enviar
 * @param {Object} options - Opciones adicionales
 * @returns {Promise<Object>} Resultado del envío
 */
const sendTwilioMessage = async (to, message, options = {}) => {
  if (!twilioClient) {
    throw new Error('Cliente Twilio no está configurado');
  }

  try {
    const toFormatted = formatPhoneNumber(to);
    const fromFormatted = `whatsapp:${twilioConfig.phoneNumber}`;
    const toWhatsApp = `whatsapp:${toFormatted}`;

    logger.debug('Enviando mensaje via Twilio', {
      to: toFormatted,
      messageLength: message.length,
      mediaUrl: options.mediaUrl ? 'included' : 'none'
    });

    const messageData = {
      body: message,
      from: fromFormatted,
      to: toWhatsApp,
    };

    // Agregar media si está presente
    if (options.mediaUrl) {
      messageData.mediaUrl = [options.mediaUrl];
    }

    const result = await twilioClient.messages.create(messageData);

    logger.info('Mensaje enviado exitosamente via Twilio', {
      sid: result.sid,
      to: toFormatted,
      status: result.status,
      direction: result.direction
    });

    return {
      success: true,
      messageId: result.sid,
      status: result.status,
      provider: 'twilio'
    };

  } catch (error) {
    logger.error('Error enviando mensaje via Twilio', {
      to,
      error: error.message,
      code: error.code,
      moreInfo: error.moreInfo
    });

    throw error;
  }
};

// ============================================
// FUNCIONES DE META WHATSAPP BUSINESS API
// ============================================

/**
 * Envía un mensaje via Meta WhatsApp Business API
 * @param {string} to - Número de teléfono destino
 * @param {string} message - Mensaje a enviar
 * @param {Object} options - Opciones adicionales
 * @returns {Promise<Object>} Resultado del envío
 */
const sendMetaMessage = async (to, message, options = {}) => {
  if (!metaConfig.accessToken || !metaConfig.phoneNumberId) {
    throw new Error('Meta WhatsApp API no está configurada');
  }

  try {
    const toFormatted = formatPhoneNumber(to).replace('+', '');
    const url = `${metaConfig.baseUrl}/${metaConfig.apiVersion}/${metaConfig.phoneNumberId}/messages`;

    const messageData = {
      messaging_product: 'whatsapp',
      to: toFormatted,
      type: 'text',
      text: {
        body: message
      }
    };

    // Para mensajes con media
    if (options.mediaUrl) {
      messageData.type = 'image';
      messageData.image = {
        link: options.mediaUrl
      };
      delete messageData.text;
    }

    logger.debug('Enviando mensaje via Meta WhatsApp', {
      to: toFormatted,
      messageLength: message.length,
      type: messageData.type
    });

    const response = await axios.post(url, messageData, {
      headers: {
        'Authorization': `Bearer ${metaConfig.accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    logger.info('Mensaje enviado exitosamente via Meta WhatsApp', {
      messageId: response.data.messages[0].id,
      to: toFormatted,
      status: 'sent'
    });

    return {
      success: true,
      messageId: response.data.messages[0].id,
      status: 'sent',
      provider: 'meta'
    };

  } catch (error) {
    logger.error('Error enviando mensaje via Meta WhatsApp', {
      to,
      error: error.message,
      status: error.response?.status,
      data: error.response?.data
    });

    throw error;
  }
};

// ============================================
// FUNCIÓN PRINCIPAL DE ENVÍO
// ============================================

/**
 * Envía un mensaje de WhatsApp usando el proveedor disponible
 * @param {string} to - Número de teléfono destino
 * @param {string} message - Mensaje a enviar
 * @param {Object} options - Opciones adicionales
 * @returns {Promise<Object>} Resultado del envío
 */
const sendWhatsAppMessage = async (to, message, options = {}) => {
  if (!isValidWhatsAppNumber(to)) {
    throw new Error('Número de WhatsApp inválido');
  }

  // Truncar mensaje si es muy largo
  const maxLength = 4096;
  const truncatedMessage = message.length > maxLength 
    ? message.substring(0, maxLength - 3) + '...'
    : message;

  try {
    // Intentar con Meta WhatsApp primero, luego Twilio
    if (metaConfig.accessToken && metaConfig.phoneNumberId) {
      return await sendMetaMessage(to, truncatedMessage, options);
    } else if (twilioClient) {
      return await sendTwilioMessage(to, truncatedMessage, options);
    } else {
      throw new Error('Ningún proveedor de WhatsApp está configurado');
    }

  } catch (error) {
    logger.error('Error enviando mensaje de WhatsApp', {
      to,
      provider: metaConfig.accessToken ? 'meta' : 'twilio',
      error: error.message
    });

    throw error;
  }
};

// ============================================
// VALIDACIÓN DE WEBHOOKS
// ============================================

/**
 * Valida webhook de Twilio
 * @param {string} signature - Firma del webhook
 * @param {string} url - URL del webhook
 * @param {Object} params - Parámetros del webhook
 * @returns {boolean} True si es válido
 */
const validateTwilioWebhook = (signature, url, params) => {
  if (!twilioClient) {
    return false;
  }

  try {
    return twilio.validateRequest(
      twilioConfig.authToken,
      signature,
      url,
      params
    );
  } catch (error) {
    logger.error('Error validando webhook de Twilio:', error);
    return false;
  }
};

/**
 * Valida webhook de Meta WhatsApp
 * @param {string} mode - Modo de verificación
 * @param {string} token - Token de verificación
 * @param {string} challenge - Challenge de verificación
 * @returns {string|boolean} Challenge si es válido, false si no
 */
const validateMetaWebhook = (mode, token, challenge) => {
  if (mode === 'subscribe' && token === metaConfig.verifyToken) {
    logger.info('Webhook de Meta WhatsApp verificado exitosamente');
    return challenge;
  }
  
  logger.warn('Intento de verificación de webhook inválido', { mode, token });
  return false;
};

// ============================================
// PROCESAMIENTO DE MENSAJES ENTRANTES
// ============================================

/**
 * Procesa mensaje entrante de Twilio
 * @param {Object} webhookData - Datos del webhook
 * @returns {Object} Mensaje procesado
 */
const processTwilioIncomingMessage = (webhookData) => {
  return {
    messageId: webhookData.MessageSid,
    from: webhookData.From.replace('whatsapp:', ''),
    to: webhookData.To.replace('whatsapp:', ''),
    body: webhookData.Body || '',
    timestamp: new Date(),
    provider: 'twilio',
    mediaUrl: webhookData.MediaUrl0 || null,
    mediaType: webhookData.MediaContentType0 || null
  };
};

/**
 * Procesa mensaje entrante de Meta WhatsApp
 * @param {Object} webhookData - Datos del webhook
 * @returns {Object} Mensaje procesado
 */
const processMetaIncomingMessage = (webhookData) => {
  const entry = webhookData.entry[0];
  const changes = entry.changes[0];
  const value = changes.value;
  
  if (!value.messages || value.messages.length === 0) {
    return null;
  }

  const message = value.messages[0];
  
  return {
    messageId: message.id,
    from: '+' + message.from,
    to: '+' + value.metadata.phone_number_id,
    body: message.text?.body || '',
    timestamp: new Date(parseInt(message.timestamp) * 1000),
    provider: 'meta',
    mediaUrl: message.image?.id || null,
    mediaType: message.type
  };
};

// ============================================
// FUNCIONES DE UTILIDAD
// ============================================

/**
 * Verifica el estado de los servicios de WhatsApp
 * @returns {Promise<Object>} Estado de los servicios
 */
const checkWhatsAppStatus = async () => {
  const status = {
    twilio: false,
    meta: false,
    activeProvider: null
  };

  // Verificar Twilio
  if (twilioClient) {
    try {
      await twilioClient.api.accounts(twilioConfig.accountSid).fetch();
      status.twilio = true;
    } catch (error) {
      logger.error('Error verificando estado de Twilio:', error);
    }
  }

  // Verificar Meta
  if (metaConfig.accessToken) {
    try {
      const url = `${metaConfig.baseUrl}/${metaConfig.apiVersion}/${metaConfig.phoneNumberId}`;
      await axios.get(url, {
        headers: { 'Authorization': `Bearer ${metaConfig.accessToken}` }
      });
      status.meta = true;
    } catch (error) {
      logger.error('Error verificando estado de Meta WhatsApp:', error);
    }
  }

  // Determinar proveedor activo
  status.activeProvider = status.meta ? 'meta' : (status.twilio ? 'twilio' : null);

  return status;
};

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // Configuración
  twilioConfig,
  metaConfig,
  twilioClient,
  
  // Funciones principales
  sendWhatsAppMessage,
  sendTwilioMessage,
  sendMetaMessage,
  
  // Validación
  validateTwilioWebhook,
  validateMetaWebhook,
  isValidWhatsAppNumber,
  
  // Procesamiento
  processTwilioIncomingMessage,
  processMetaIncomingMessage,
  
  // Utilidades
  formatPhoneNumber,
  checkWhatsAppStatus
};