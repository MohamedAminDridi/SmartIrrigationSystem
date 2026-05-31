const { createLogger, format, transports } = require('winston');
const { combine, timestamp, colorize, printf, errors } = format;
const fmt = printf(({ level, message, timestamp, stack }) =>
  stack ? `${timestamp} [${level}]: ${message}\n${stack}`
        : `${timestamp} [${level}]: ${message}`);

module.exports = createLogger({
  level:  process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
  silent: process.env.NODE_ENV === 'test',
  format: combine(errors({ stack:true }), timestamp({ format:'HH:mm:ss' }), fmt),
  transports: [
    new transports.Console({ format: combine(colorize(), timestamp({ format:'HH:mm:ss' }), fmt) }),
    new transports.File({ filename:'logs/error.log',    level:'error' }),
    new transports.File({ filename:'logs/combined.log' }),
  ],
});
