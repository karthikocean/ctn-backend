module.exports = {
  apps: [
    {
      name: 'ctn-backend',
      script: 'dist/index.js',
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,

      node_args: [
        '--max-old-space-size=4096',
        '--expose-gc'
      ],

      max_memory_restart: '3G',
      watch: false,

      env: {
        NODE_ENV: 'production',
        PUPPETEER_EXECUTABLE_PATH: '/snap/bin/chromium'
      },

      env_production: {
        NODE_ENV: 'production',
        PUPPETEER_EXECUTABLE_PATH: '/snap/bin/chromium'
      }
    }
    ,
    {
      name: 'ctn-mcp',
      script: 'dist/mcp/index.js',
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,

      node_args: [
        '--max-old-space-size=1024'
      ],

      max_memory_restart: '1G',
      watch: false,

      // MCP server is disabled by default — set MCP_ENABLED=true in .env to activate
      env: {
        NODE_ENV: 'production',
        MCP_ENABLED: 'false'
      },

      env_production: {
        NODE_ENV: 'production',
        MCP_ENABLED: 'false'
      }
    }
  ]
};