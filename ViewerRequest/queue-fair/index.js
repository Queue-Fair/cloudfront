'use strict';

const qfs = require('./QueueFairService');
const qfa = require('./QueueFairAdapter');
const qfc = require('./QueueFairConfig');

exports.service = (req, res) => {
  return qfs.service(req, res);
};

exports.adapter = (config, service) => {
  return qfa.adapter(config, service);
};

exports.config = qfc;
