-- ============================================
-- MIGRACIÓN: SISTEMA DE USUARIOS Y ROLES
-- Archivo: database/migrations/002_users_and_roles.sql
-- ============================================

-- Extensión para UUID si no existe
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- TABLA: ROLES
-- ============================================
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) UNIQUE NOT NULL, -- 'super_admin', 'admin', 'manager', 'staff'
    display_name VARCHAR(100) NOT NULL, -- 'Super Administrador', 'Administrador', etc.
    description TEXT,
    permissions JSONB DEFAULT '[]', -- Array de permisos específicos
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABLA: USUARIOS
-- ============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    
    -- Relaciones
    role_id UUID NOT NULL REFERENCES roles(id),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE, -- NULL para super_admin
    
    -- Estado del usuario
    is_active BOOLEAN DEFAULT true,
    email_verified BOOLEAN DEFAULT false,
    last_login_at TIMESTAMP,
    
    -- Tokens y seguridad
    password_reset_token VARCHAR(255),
    password_reset_expires TIMESTAMP,
    email_verification_token VARCHAR(255),
    
    -- Metadatos
    created_by UUID REFERENCES users(id), -- Quien creó este usuario
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABLA: PERFILES DE USUARIO
-- ============================================
CREATE TABLE user_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Información personal
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone VARCHAR(20),
    avatar_url VARCHAR(500),
    
    -- Configuraciones
    language VARCHAR(5) DEFAULT 'es',
    timezone VARCHAR(50) DEFAULT 'America/Mexico_City',
    notifications_enabled BOOLEAN DEFAULT true,
    
    -- Metadatos
    last_profile_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABLA: SESIONES DE USUARIO (Opcional - para tracking)
-- ============================================
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Información de sesión
    token_id VARCHAR(255) NOT NULL, -- ID del JWT token
    ip_address INET,
    user_agent TEXT,
    
    -- Estado
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMP NOT NULL,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- ÍNDICES PARA OPTIMIZACIÓN
-- ============================================

-- Usuarios
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role_id);
CREATE INDEX idx_users_restaurant ON users(restaurant_id) WHERE restaurant_id IS NOT NULL;
CREATE INDEX idx_users_active ON users(is_active) WHERE is_active = true;

-- Perfiles
CREATE INDEX idx_profiles_user ON user_profiles(user_id);
CREATE INDEX idx_profiles_names ON user_profiles(first_name, last_name);

-- Sesiones
CREATE INDEX idx_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_sessions_token ON user_sessions(token_id);
CREATE INDEX idx_sessions_active ON user_sessions(is_active, expires_at) WHERE is_active = true;

-- ============================================
-- TRIGGERS PARA UPDATED_AT
-- ============================================

CREATE TRIGGER update_roles_updated_at
    BEFORE UPDATE ON roles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- INSERTAR ROLES PREDETERMINADOS
-- ============================================

INSERT INTO roles (id, name, display_name, description, permissions) VALUES
(
    '11111111-1111-1111-1111-111111111111',
    'super_admin',
    'Super Administrador',
    'Acceso completo al sistema. Puede gestionar todos los restaurantes y usuarios.',
    '["all"]'
),
(
    '22222222-2222-2222-2222-222222222222',
    'admin',
    'Administrador de Restaurante',
    'Administrador completo de un restaurante específico. Puede gestionar menús, pedidos, usuarios del restaurante.',
    '["restaurant.manage", "menu.manage", "orders.manage", "users.manage_restaurant", "reports.view"]'
),
(
    '33333333-3333-3333-3333-333333333333',
    'manager',
    'Gerente',
    'Gerente de restaurante. Puede gestionar operaciones diarias, menús y empleados.',
    '["menu.manage", "orders.manage", "users.manage_staff", "reports.view"]'
),
(
    '44444444-4444-4444-4444-444444444444',
    'staff',
    'Empleado',
    'Personal del restaurante. Puede ver y actualizar pedidos, cambiar disponibilidad de productos.',
    '["orders.view", "orders.update_status", "menu.update_availability"]'
);

-- ============================================
-- CREAR SUPER USUARIO INICIAL
-- ============================================

-- Insertar super usuario (cambiar email y contraseña)
INSERT INTO users (
    id, 
    email, 
    password_hash, 
    role_id, 
    restaurant_id, 
    is_active, 
    email_verified
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    'admin@chatbot-chingon.com', -- CAMBIAR POR TU EMAIL
    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', -- password123 - CAMBIAR
    '11111111-1111-1111-1111-111111111111', -- super_admin role
    NULL, -- Sin restaurante específico
    true,
    true
);

-- Insertar perfil del super usuario
INSERT INTO user_profiles (
    user_id,
    first_name,
    last_name,
    phone
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    'Super',
    'Administrador',
    '+52XXXXXXXXXX' -- CAMBIAR POR TU TELÉFONO
);

-- ============================================
-- FUNCIONES DE UTILIDAD
-- ============================================

-- Función para limpiar sesiones expiradas
CREATE OR REPLACE FUNCTION clean_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM user_sessions 
    WHERE expires_at < CURRENT_TIMESTAMP 
    OR is_active = false;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Función para verificar permisos de usuario
CREATE OR REPLACE FUNCTION user_has_permission(user_uuid UUID, required_permission TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    user_permissions JSONB;
    has_permission BOOLEAN := false;
BEGIN
    -- Obtener permisos del usuario
    SELECT r.permissions INTO user_permissions
    FROM users u
    JOIN roles r ON u.role_id = r.id
    WHERE u.id = user_uuid AND u.is_active = true;
    
    -- Si no se encuentra el usuario
    IF user_permissions IS NULL THEN
        RETURN false;
    END IF;
    
    -- Si tiene permiso "all" (super admin)
    IF user_permissions ? 'all' THEN
        RETURN true;
    END IF;
    
    -- Verificar permiso específico
    IF user_permissions ? required_permission THEN
        RETURN true;
    END IF;
    
    RETURN false;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- VERIFICACIÓN DE INSTALACIÓN
-- ============================================

-- Función para verificar la instalación de usuarios
CREATE OR REPLACE FUNCTION verify_users_installation()
RETURNS TEXT AS $$
DECLARE
    roles_count INTEGER;
    users_count INTEGER;
    profiles_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO roles_count FROM roles;
    SELECT COUNT(*) INTO users_count FROM users;
    SELECT COUNT(*) INTO profiles_count FROM user_profiles;
    
    RETURN FORMAT('✅ Sistema de usuarios instalado: %s roles, %s usuarios, %s perfiles', 
                  roles_count, users_count, profiles_count);
END;
$$ LANGUAGE plpgsql;

-- Ejecutar verificación
SELECT verify_users_installation();