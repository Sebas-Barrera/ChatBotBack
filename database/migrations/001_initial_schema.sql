-- ============================================
-- CHATBOT CHINGÓN - MIGRACIÓN INICIAL
-- Versión: 1.0.0
-- Fecha: 2024-12-19
-- ============================================

-- Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- Para búsquedas de texto

-- ============================================
-- TABLA: RESTAURANTES (TENANTS)
-- ============================================
CREATE TABLE restaurants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL, -- hot-wings, minguela
    phone VARCHAR(20) UNIQUE NOT NULL, -- +525512345678
    email VARCHAR(255),
    address TEXT,
    logo_url VARCHAR(500),
    
    -- Configuración de operación
    is_active BOOLEAN DEFAULT true,
    opens_at TIME DEFAULT '09:00:00',
    closes_at TIME DEFAULT '23:00:00',
    delivery_time_min INTEGER DEFAULT 25, -- minutos mínimos
    delivery_time_max INTEGER DEFAULT 35, -- minutos máximos
    delivery_fee DECIMAL(8,2) DEFAULT 0.00,
    minimum_order DECIMAL(8,2) DEFAULT 0.00,
    
    -- WhatsApp API Config
    whatsapp_phone_id VARCHAR(100), -- Para Meta WhatsApp API
    whatsapp_token VARCHAR(500),
    twilio_phone_number VARCHAR(20), -- Para Twilio
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT restaurants_slug_format CHECK (slug ~ '^[a-z0-9-]+$')
);

-- ============================================
-- TABLA: ZONAS DE ENTREGA
-- ============================================
CREATE TABLE delivery_zones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    zone_name VARCHAR(100) NOT NULL, -- "Centro", "Zona Norte"
    postal_codes TEXT[], -- Array de códigos postales
    neighborhoods TEXT[], -- Array de colonias
    extra_fee DECIMAL(8,2) DEFAULT 0.00, -- Costo extra por zona
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABLA: CATEGORÍAS DE MENÚ
-- ============================================
CREATE TABLE menu_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL, -- "Alitas", "Bebidas", "Hotdogs"
    description TEXT,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    emoji VARCHAR(10), -- 🍗, 🍺, 🌭
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(restaurant_id, name)
);

-- ============================================
-- TABLA: PRODUCTOS DEL MENÚ
-- ============================================
CREATE TABLE menu_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
    
    -- Información básica
    name VARCHAR(255) NOT NULL, -- "Media orden de alitas"
    description TEXT, -- "6 piezas de alitas jugosas"
    price DECIMAL(8,2) NOT NULL,
    
    -- Configuración de producto
    is_available BOOLEAN DEFAULT true,
    preparation_time INTEGER DEFAULT 15, -- minutos
    display_order INTEGER DEFAULT 0,
    
    -- Información nutricional (opcional)
    calories INTEGER,
    ingredients TEXT[],
    allergens TEXT[], -- "lacteos", "gluten"
    
    -- Imagen
    image_url VARCHAR(500),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABLA: REGLAS DE NEGOCIO
-- ============================================
CREATE TABLE business_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    menu_item_id UUID REFERENCES menu_items(id) ON DELETE CASCADE, -- NULL = regla global
    
    -- Tipo de regla
    rule_type VARCHAR(50) NOT NULL, -- "sauce_limit", "extra_cost", "combo_rule", "size_option"
    rule_name VARCHAR(100) NOT NULL, -- "Aderezos incluidos"
    
    -- Configuración de la regla (JSON flexible)
    rule_config JSONB NOT NULL,
    /* Ejemplos:
    sauce_limit: {"max_included": 1, "extra_cost": 10, "available_sauces": ["BBQ", "Buffalo", "Chimichurri"]}
    size_option: {"sizes": [{"name": "Chica", "price": 60}, {"name": "Grande", "price": 90}]}
    combo_rule: {"required_items": 2, "discount_percent": 15}
    extra_cost: {"extras": [{"name": "Queso extra", "cost": 15}, {"name": "Tocino", "cost": 20}]}
    */
    
    -- Mensaje para la IA
    ai_message_template TEXT, -- "Este producto incluye {max_included} aderezo(s). Extra ${extra_cost} c/u"
    
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABLA: CLIENTES
-- ============================================
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(255),
    
    -- Datos para entrega
    default_address TEXT,
    default_references TEXT,
    
    -- Stats
    total_orders INTEGER DEFAULT 0,
    total_spent DECIMAL(10,2) DEFAULT 0.00,
    
    -- Timestamps
    first_order_at TIMESTAMP,
    last_order_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABLA: CONVERSACIONES ACTIVAS
-- ============================================
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    customer_phone VARCHAR(20) NOT NULL,
    
    -- Estado de la conversación
    status VARCHAR(20) DEFAULT 'active', -- active, completing_order, completed, abandoned
    current_step VARCHAR(50) DEFAULT 'greeting', -- greeting, ordering, address, confirming
    
    -- Datos del pedido en construcción
    order_data JSONB DEFAULT '{}',
    /* Estructura:
    {
        "items": [
            {
                "menu_item_id": "uuid",
                "name": "Media orden alitas BBQ",
                "quantity": 1,
                "base_price": 90,
                "customizations": [
                    {"type": "sauce", "name": "BBQ", "extra_cost": 0},
                    {"type": "sauce", "name": "Chimichurri", "extra_cost": 10}
                ],
                "item_total": 100,
                "notes": "Sin cebolla"
            }
        ],
        "subtotal": 100,
        "delivery_fee": 0,
        "total": 100,
        "delivery_address": {
            "street": "Calle Reforma",
            "number": "123",
            "neighborhood": "Centro",
            "references": "Entre 5 de Mayo y Hidalgo",
            "postal_code": "12345"
        }
    }
    */
    
    -- Contexto para Claude
    ai_context JSONB DEFAULT '[]', -- Historial de mensajes
    conversation_summary TEXT, -- Resumen generado por IA
    
    -- Timestamps
    last_interaction_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABLA: PEDIDOS COMPLETADOS
-- ============================================
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id),
    conversation_id UUID REFERENCES conversations(id),
    
    -- Información del cliente
    customer_phone VARCHAR(20) NOT NULL,
    customer_name VARCHAR(255),
    
    -- Dirección de entrega
    delivery_street VARCHAR(255) NOT NULL,
    delivery_number VARCHAR(50) NOT NULL,
    delivery_neighborhood VARCHAR(255) NOT NULL,
    delivery_references TEXT,
    delivery_postal_code VARCHAR(10),
    
    -- Estado del pedido
    status VARCHAR(20) DEFAULT 'confirmed', -- confirmed, preparing, ready, delivered, cancelled
    
    -- Montos
    subtotal DECIMAL(8,2) NOT NULL,
    delivery_fee DECIMAL(8,2) DEFAULT 0.00,
    total DECIMAL(8,2) NOT NULL,
    
    -- Tiempos
    estimated_delivery_time INTEGER, -- minutos
    confirmed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    delivered_at TIMESTAMP,
    
    -- Notas
    special_instructions TEXT,
    internal_notes TEXT, -- Para el restaurante
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABLA: ITEMS DE PEDIDOS
-- ============================================
CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id UUID NOT NULL REFERENCES menu_items(id),
    
    -- Información del producto al momento del pedido
    item_name VARCHAR(255) NOT NULL, -- Snapshot del nombre
    base_price DECIMAL(8,2) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    
    -- Personalizaciones
    customizations JSONB DEFAULT '[]',
    /* Ejemplo:
    [
        {"type": "sauce", "name": "BBQ", "extra_cost": 0},
        {"type": "sauce", "name": "Chimichurri", "extra_cost": 10},
        {"type": "extra", "name": "Queso extra", "extra_cost": 15}
    ]
    */
    
    customizations_cost DECIMAL(8,2) DEFAULT 0.00,
    item_total DECIMAL(8,2) NOT NULL, -- (base_price + customizations_cost) * quantity
    
    special_notes TEXT, -- "Sin cebolla", "Bien cocidas"
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABLA: CONFIGURACIONES DEL RESTAURANTE
-- ============================================
CREATE TABLE restaurant_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID UNIQUE NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    
    -- Configuración de Claude
    claude_api_key VARCHAR(500),
    claude_model VARCHAR(50) DEFAULT 'claude-3-5-sonnet-20241022',
    ai_personality TEXT DEFAULT 'Amigable y servicial',
    
    -- Mensajes predefinidos
    welcome_message TEXT DEFAULT '¡Hola! Bienvenido a nuestro restaurante 🍴',
    goodbye_message TEXT DEFAULT '¡Gracias por tu pedido! Te esperamos pronto 😊',
    error_message TEXT DEFAULT 'Lo siento, tuve un problema. ¿Puedes repetir tu mensaje?',
    
    -- Configuración de negocio
    auto_confirm_orders BOOLEAN DEFAULT false,
    require_phone_validation BOOLEAN DEFAULT false,
    max_conversation_time INTEGER DEFAULT 1800, -- 30 minutos
    
    -- Notificaciones
    notification_email VARCHAR(255),
    notification_phone VARCHAR(20),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- ÍNDICES PARA OPTIMIZACIÓN
-- ============================================

-- Índices principales para queries frecuentes
CREATE INDEX idx_restaurants_slug ON restaurants(slug);
CREATE INDEX idx_restaurants_phone ON restaurants(phone);
CREATE INDEX idx_restaurants_active ON restaurants(is_active) WHERE is_active = true;

CREATE INDEX idx_menu_items_restaurant ON menu_items(restaurant_id, is_available) WHERE is_available = true;
CREATE INDEX idx_menu_items_category ON menu_items(category_id, display_order);

CREATE INDEX idx_business_rules_item ON business_rules(menu_item_id, rule_type) WHERE is_active = true;
CREATE INDEX idx_business_rules_restaurant ON business_rules(restaurant_id, rule_type) WHERE is_active = true;

CREATE INDEX idx_conversations_active ON conversations(restaurant_id, customer_phone, status) WHERE status = 'active';
CREATE INDEX idx_conversations_last_interaction ON conversations(last_interaction_at) WHERE status = 'active';

CREATE INDEX idx_orders_restaurant_status ON orders(restaurant_id, status, created_at);
CREATE INDEX idx_orders_customer ON orders(customer_phone, created_at);
CREATE INDEX idx_orders_date ON orders(created_at);

CREATE INDEX idx_order_items_order ON order_items(order_id);

-- Índices para búsquedas de texto
CREATE INDEX idx_menu_items_name_trgm ON menu_items USING gin(name gin_trgm_ops);
CREATE INDEX idx_customers_phone ON customers(phone);

-- ============================================
-- TRIGGERS PARA UPDATED_AT
-- ============================================

-- Función para actualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers
CREATE TRIGGER update_restaurants_updated_at BEFORE UPDATE ON restaurants FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_menu_items_updated_at BEFORE UPDATE ON menu_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_restaurant_settings_updated_at BEFORE UPDATE ON restaurant_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- FUNCIÓN: LIMPIAR CONVERSACIONES INACTIVAS
-- ============================================
CREATE OR REPLACE FUNCTION clean_inactive_conversations()
RETURNS INTEGER AS $$
DECLARE
    cleaned_count INTEGER;
BEGIN
    -- Marcar como abandonadas las conversaciones inactivas por más de 2 horas
    UPDATE conversations 
    SET status = 'abandoned'
    WHERE status = 'active' 
    AND last_interaction_at < CURRENT_TIMESTAMP - INTERVAL '2 hours';
    
    GET DIAGNOSTICS cleaned_count = ROW_COUNT;
    RETURN cleaned_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- COMENTARIOS DE DOCUMENTACIÓN
-- ============================================

COMMENT ON TABLE restaurants IS 'Información de cada restaurante/tenant del sistema';
COMMENT ON TABLE menu_items IS 'Productos del menú por restaurante';
COMMENT ON TABLE business_rules IS 'Reglas de negocio específicas (aderezos, extras, combos)';
COMMENT ON TABLE conversations IS 'Sesiones de chat activas con estado del pedido';
COMMENT ON TABLE orders IS 'Pedidos completados';
COMMENT ON TABLE order_items IS 'Items específicos de cada pedido con customizaciones';

COMMENT ON COLUMN business_rules.rule_config IS 'Configuración JSON flexible para diferentes tipos de reglas';
COMMENT ON COLUMN conversations.order_data IS 'Estado actual del pedido en construcción (JSON)';
COMMENT ON COLUMN conversations.ai_context IS 'Historial de conversación para Claude';
COMMENT ON COLUMN order_items.customizations IS 'Array JSON de personalizaciones del item';

-- ============================================
-- DATOS DE EJEMPLO PARA DESARROLLO
-- ============================================

-- Insertar restaurante de ejemplo
INSERT INTO restaurants (
    id, name, slug, phone, email, address,
    opens_at, closes_at, delivery_time_min, delivery_time_max
) VALUES (
    '550e8400-e29b-41d4-a716-446655440000',
    'Hot Wings Express',
    'hot-wings-express',
    '+525512345678',
    'info@hotwings.com',
    'Av. Insurgentes Sur 123, Col. Roma Norte, CDMX',
    '10:00:00',
    '23:00:00',
    25,
    35
);

-- Insertar configuración del restaurante de ejemplo
INSERT INTO restaurant_settings (
    id, restaurant_id, ai_personality, welcome_message, goodbye_message
) VALUES (
    '660e8400-e29b-41d4-a716-446655440000',
    '550e8400-e29b-41d4-a716-446655440000',
    'Amigable, rápido y conocedor de alitas',
    '¡Hola! 👋 Bienvenido a Hot Wings Express. ¿Listo para unas alitas deliciosas?',
    '¡Gracias por tu pedido! 🍗 Tu comida llegará pronto. ¡Disfrútala!'
);

-- Insertar categorías de ejemplo
INSERT INTO menu_categories (
    id, restaurant_id, name, description, display_order, emoji
) VALUES 
    ('770e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440000', 'Alitas', 'Nuestras deliciosas alitas en diferentes sabores', 1, '🍗'),
    ('770e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440000', 'Bebidas', 'Refrescantes bebidas para acompañar', 2, '🥤'),
    ('770e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440000', 'Hotdogs', 'Hotdogs gourmet', 3, '🌭');

-- Insertar items de menú de ejemplo
INSERT INTO menu_items (
    id, restaurant_id, category_id, name, description, price, preparation_time
) VALUES 
    ('880e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440000', '770e8400-e29b-41d4-a716-446655440000', 'Media Orden de Alitas', '6 piezas de alitas jugosas', 85.00, 15),
    ('880e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440000', '770e8400-e29b-41d4-a716-446655440000', 'Orden Completa de Alitas', '12 piezas de alitas jugosas', 130.00, 18),
    ('880e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440000', '770e8400-e29b-41d4-a716-446655440001', 'Refresco Grande', 'Coca Cola, Sprite o Fanta', 25.00, 2),
    ('880e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440000', '770e8400-e29b-41d4-a716-446655440002', 'Hotdog Clásico', 'Con mostaza, catsup y mayonesa', 45.00, 8);

-- Insertar reglas de negocio de ejemplo
INSERT INTO business_rules (
    id, restaurant_id, menu_item_id, rule_type, rule_name, rule_config, ai_message_template
) VALUES 
    ('990e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440000', '880e8400-e29b-41d4-a716-446655440000', 'sauce_limit', 'Aderezos Media Orden', '{"max_included": 1, "extra_cost": 10, "available_sauces": ["BBQ", "Buffalo", "Chimichurri", "Mango Habanero"]}', 'La media orden incluye 1 aderezo gratis. Aderezos extra $10 c/u'),
    ('990e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440000', '880e8400-e29b-41d4-a716-446655440001', 'sauce_limit', 'Aderezos Orden Completa', '{"max_included": 2, "extra_cost": 10, "available_sauces": ["BBQ", "Buffalo", "Chimichurri", "Mango Habanero"]}', 'La orden completa incluye 2 aderezos gratis. Aderezos extra $10 c/u');

-- ============================================
-- VERIFICACIÓN DE INSTALACIÓN
-- ============================================

-- Función para verificar que todo se instaló correctamente
CREATE OR REPLACE FUNCTION verify_installation()
RETURNS TEXT AS $$
DECLARE
    table_count INTEGER;
    index_count INTEGER;
    function_count INTEGER;
BEGIN
    -- Contar tablas creadas
    SELECT COUNT(*) INTO table_count
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name IN ('restaurants', 'delivery_zones', 'menu_categories', 'menu_items', 'business_rules', 'customers', 'conversations', 'orders', 'order_items', 'restaurant_settings');
    
    -- Contar índices creados
    SELECT COUNT(*) INTO index_count
    FROM pg_indexes 
    WHERE schemaname = 'public'
    AND indexname LIKE 'idx_%';
    
    -- Contar funciones creadas
    SELECT COUNT(*) INTO function_count
    FROM information_schema.routines
    WHERE routine_schema = 'public'
    AND routine_name IN ('update_updated_at_column', 'clean_inactive_conversations', 'verify_installation');
    
    RETURN FORMAT('✅ Instalación completada: %s tablas, %s índices, %s funciones creadas', table_count, index_count, function_count);
END;
$$ LANGUAGE plpgsql;

-- Ejecutar verificación
SELECT verify_installation();