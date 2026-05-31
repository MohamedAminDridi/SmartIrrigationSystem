const Joi = require('joi');

exports.registerSchema = Joi.object({
  name:     Joi.string().min(2).max(50).required(),
  email:    Joi.string().email().required(),
  password: Joi.string().min(8)
              .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).required()
              .messages({ 'string.pattern.base': 'Password needs uppercase, lowercase and a digit' }),
  phone:    Joi.string().allow('',null),
  role:     Joi.string().valid('farmer','viewer','technician').default('farmer'),
});

exports.loginSchema = Joi.object({
  email:    Joi.string().email().required(),
  password: Joi.string().required(),
});

exports.updateProfileSchema = Joi.object({
  name:  Joi.string().min(2).max(50),
  phone: Joi.string().allow('',null),
});
