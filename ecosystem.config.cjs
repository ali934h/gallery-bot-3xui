module.exports = {
  apps: [
    {
      name: "tg-gallery",
      script: "src/index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      out_file: "logs/out.log",
      error_file: "logs/error.log",
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
