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
  ]
};