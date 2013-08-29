var os = require('os')
  , util = require('util')
  , ip = require('ip')
  , request = require('request')
  , registrations = require('thalassa-registrations')
  , EventEmitter = require('events').EventEmitter
  ;

var Client = module.exports = function (opts) {
  if (typeof opts !== 'object') opts = {};
  EventEmitter.call(this);

  this.log = (typeof opts.log === 'function') ? opts.log : function (){};

  this.PORT         = opts.apiport || 5001;
  this.APIPORT      = opts.apiport || 10000;
  this.HOST         = opts.host || '127.0.0.1';
  this.UPDATE_FREQ  = opts.updateFreq || 5000;
  this.MODE         = opts.mode || 'http';
  this.MY_IP        = ip.address();

  this.isOn = false;
  this.intents = [];
  this.registrations = [];
  this.pending = {};

  this.socket = null;

};

util.inherits(Client, EventEmitter);

//
// 
//
Client.prototype.register = function(name, version, port, meta) {
  var self = this;
  var reg = {
    name: name,
    version: version,
    host: self.MY_IP,
    port: port,
    meta: meta || {}
  };

  if (!reg.meta.hostname) reg.meta.hostname = reg.host;

  reg.meta.hostname = os.hostname();
  reg.meta.pid = process.pid;
  reg.meta.registered = Date.now();

  var intent = registrations.create(reg);
  self.intents.push(intent);

  if (self.isOn) {
    self._sendUpdate(intent);
  }
};

Client.prototype.unregister = function(name, version, port) {
  var self = this;
  var reg = registrations.create({
    name: name,
    version: version,
    host: self.MY_IP,
    port: port,
  });

  //
  // filter out the unwanted registration intent
  //
  self.intents = self.intents.filter(function (intent) {
    return reg.id !== intent.id;
  });
};

Client.prototype.start = function() {
  var self = this;
  if (!self.isOn) {
    self.isOn = true;
    self._startUpdateInterval();
  }
};

Client.prototype.stop = function() {
  var self = this;
  self.isOn = false;
  clearInterval(self._updateInterval);
  self.registrations.forEach(function (reg) {
    self.seaport.free(reg);
  });
};

Client.prototype.getRegistrations = function(name, version, cb) {
  var self = this;

  var path;
  if (typeof name === 'function') {
    cb = name;
    path = '/registrations';
  }
  else if (typeof version === 'function') {
    cb = version;
    path = util.format('/registrations/%s', name);
  }
  else if (typeof cb === 'function') {
    path = util.format('/registrations/%s/%s', name, version);
  }

  var uri = util.format('http://%s:%s%s', self.HOST, self.APIPORT, path);

  self.log('debug', 'Thalassa:Client.getRegistrations uri: ' + uri);

  request({
    uri: uri,
    json: true
  },
  function (error, response, body) {
    if (error) self.log('error', 'Thalassa:Client.getRegistrations', error);
    if (response && response.statusCode !== 200 && response.statusCode !== 404) {
      self.log('error', 'Thalassa:Client.getRegistrations unexpected response ' + response.statusCode);
      error = new Error("getRegistrations unexpected response " + response.statusCode);
    }
    if (error) return cb(error);

    var regs = (response.statusCode !== 200) ? [] : body;
    cb(null, regs);
  });
};

Client.prototype._keySearch = function(name, version) {
  var keySearch = (name) ? ('/' + name) : '';
  keySearch += (version) ? util.format('/%s/', version) : '/'
  return keySearch;
};

Client.prototype._startUpdateInterval = function() {
  var self = this;
  update();
  self._updateInterval = setInterval(update, self.UPDATE_FREQ);

  function update () {
    self.intents.forEach(self._sendUpdate.bind(self));
  }
};

Client.prototype._sendUpdate = function (intent) {
  if (this.MODE === 'http') {
    this._sendHTTPUpdate(intent);
  }
  else {
    this.log('error', 'Thalassa:Client._sendUpdate: unsupported mode ' + this.mode);
  }
};

// TODO batch multiple requests?

Client.prototype._sendHTTPUpdate = function (intent) {
  var self = this;
  var uri = util.format('http://%s:%s/registrations/%s/%s/%s/%s', self.HOST, self.APIPORT, intent.name, intent.version, intent.host, intent.port);

  //
  // If the last call is stil pending, don't add fuel to the fire
  //
  if (self.pending[intent.id]) {
    self.log('error', 'Thalassa:Client._sendHTTPUpdate last call still pending! (skipping): ' + intent.id);
    return ;
  }

  self.pending[intent.id] = true;

  request({
    uri: uri,
    method: 'POST',
    json: intent.meta
  },
  function (error, response, body) {
    self.pending[intent.id] = false;
    if (error) self.log('error', 'Thalassa:Client._sendUpdate', error);
    //else self.log('debug', util.format('Thalassa:Client._sendUpdate (%s) %s', response.statusCode, uri));
  });
};