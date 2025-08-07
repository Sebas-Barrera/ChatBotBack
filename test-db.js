require('dotenv').config();
const { testConnection, query } = require('./database/connection');

const testNeonConnection = async () => {
  try {
    console.log('🔄 Probando conexión a Neon...');
    await testConnection();
    
    console.log('🔄 Verificando tablas...');
    const result = await query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    console.log('📋 Tablas encontradas:');
    result.rows.forEach(row => console.log(`  - ${row.table_name}`));
    
    console.log('✅ ¡Todo funciona correctamente!');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
};

testNeonConnection();