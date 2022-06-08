'use strict';

const https = require('https');
const http = require('http');
const crypto = require('crypto');

module.exports = {
  adapter: function(config, service) {
    return new QueueFairAdapter(config, service);
  },
};

/** The QueueFairAdapter class */
class QueueFairAdapter {
  // Passed in constructor
  config;
  service;

  // You must set this to the full URL of the page before running the adapter.
  url = null;

  // You must set this to the visitor's User Agent before running the adapter.
  userAgent = null;

  // Optional extra data for your Queue Page.
  extra = null;

  // -------------------- Internal use only -----------------
  static cookieNameBase='QueueFair-Pass-';

  d = false;
  uid = null;
  continuePage = true;
  settings = null;
  redirectLoc=null;
  adapterResult=null;
  adapterQueue=null;
  consultingAdapter=false;
  passed = [];
  protocol = 'https';
  passedString = null;

  // For managing the getting and caching of settings.
  static memSettings = null;
  static lastMemSettingsRead = -1;
  static gettingSettings = false;
  settingsCounter = 0;
  thisIsGettingSettings = false;

  // For returning from promise or timing out.
  res=null;
  timeout = null;
  finished = false;

  /** Convenience method
   * @param {Object} config configuration for the adapter.
   * @param {Object} service a service encapsulating low level functions.
   */
  constructor(config, service) {
    this.config = config;
    if (this.config.debug === false) {
      // defaults to false.
    } else if (this.config.debug === true ||
      this.config.debug === service.remoteAddr()) {
      this.d = true;
    }
    this.service = service;
  }


  /** Convenience method
   * @param {string} haystack
   * @param {string} needle
   * @return {boolean} does haystack contain needle.
   */
  includes(haystack, needle) {
    return (haystack.indexOf(needle)!=-1);
  }

  /** Convenience method
   * @param {string} haystack
   * @param {string} needle
   * @return {boolean} does haystack start with needle.
   */
  startsWith(haystack, needle) {
    return (haystack.indexOf(needle)===0);
  }

  /** Convenience method
   * @param {string} haystack
   * @param {string} needle
   * @return {boolean} does haystack end with needle.
   */
  endsWith(haystack, needle) {
    return (haystack.indexOf(needle) != -1 &&
     haystack.indexOf(needle) == haystack.length-needle.length);
  }

  /** Is this request a match for the queue?
   * @param {Object} queue json
   * @return {boolean} whether this request matches the
   * queue's Activation Rules.
   */
  isMatch(queue) {
    if (!queue || !queue.activation || !queue.activation.rules) {
      return false;
    }
    return this.isMatchArray(queue.activation.rules);
  }

  /** Runs through an array of rules.
   * @param {Array} arr an array of rule objects.
   * @return {boolean} whether the rules match.
   */
  isMatchArray(arr) {
    if (arr == null) {
      return false;
    }

    let firstOp = true;
    let state = false;

    for (let i = 0; i < arr.length; i++) {
      const rule = arr[i];

      if (!firstOp && rule.operator != null) {
        if (rule.operator == 'And' && !state) {
          return false;
        } else if (rule.operator == 'Or' && state) {
          return true;
        }
      }

      const ruleMatch = this.isRuleMatch(rule);

      if (firstOp) {
        state = ruleMatch;
        firstOp = false;
        if (this.d) this.log('  Rule 1: ' + ((ruleMatch) ? 'true' : 'false'));
      } else {
        if (this.d) {
          this.log('  Rule ' + (i+1) +
          ': ' + ((ruleMatch) ? 'true' : 'false'));
        }
        if (rule.operator == 'And') {
          state = (state && ruleMatch);
          if (!state) {
            break;
          }
        } else if (rule.operator == 'Or') {
          state = (state || ruleMatch);
          if (state) {
            break;
          }
        }
      }
    }

    if (this.d) this.log('Final result is ' + ((state) ? 'true' : 'false'));
    return state;
  }

  /** Extract the right component for a rule.
   * @param {Object} rule the rule.
   * @param {string} url the requested URL.
   * @return {string} the component.
   */
  extractComponent(rule, url) {
    let comp = url;
    if (rule.component == 'Domain') {
      comp=comp.replace('http://', '').replace('https://', '').split(/[/?#]/)[0];
    } else if (rule.component == 'Path') {
      const domain=comp.replace('http://', '').replace('https://', '').split(/[/?#]/)[0];
      comp=comp.substring(comp.indexOf(domain)+domain.length);
      let i=0;
      if (this.startsWith(comp, ':')) {
        // We have a port
        i=comp.indexOf('/');
        if (i !=-1 ) {
          comp=comp.substring(i);
        } else {
          comp='';
        }
      }
      i=comp.indexOf('#');
      if (i!=-1) {
        comp=comp.substring(0, i);
      }
      i=comp.indexOf('?');
      if (i!=-1) {
        comp=comp.substring(0, i);
      }
      if (comp=='') {
        comp='/';
      }
    } else if (rule.component == 'Query') {
      const i = comp.indexOf('?');
      if (i == -1) {
        comp = '';
      } else if (comp == '?') {
        comp='';
      } else {
        comp = comp.substring(i+1);
      }
    } else if (rule.component == 'Cookie') {
      comp=this.getCookie(rule.name);
    }
    return comp;
  }


  /** Tests URL and cookies against a rule.
   * @param {Object} rule the rule.
   * @return {boolean} true if matched.
   */
  isRuleMatch(rule) {
    const comp = this.extractComponent(rule, this.url);
    return this.isRuleMatchWithValue(rule, comp);
  }


  /** Test a component against a rule.
   * @param {Object} rule the rule.
   * @param {string} comp the component.
   * @return {boolean} true if matched.
   */
  isRuleMatchWithValue(rule, comp) {
    let test=rule.value;

    if (rule.caseSensitive == false) {
      comp=comp.toLowerCase();
      test=test.toLowerCase();
    }
    if (this.d) this.log('Testing '+rule.component+' '+test+' against '+comp);

    let ret=false;

    if (rule.match=='Equal' && comp == test) {
      ret=true;
    } else if (rule.match=='Contain' && comp!==null &&
      this.includes(comp, test)) {
      ret=true;
    } else if (rule.match=='Exist') {
      if (typeof comp == 'undefined' || comp===null || ''===comp) {
        ret=false;
      } else {
        ret=true;
      }
    }

    if (rule.negate) {
      ret=!ret;
    }
    return ret;
  }

  /** What to do if a queue match is found.
   * @param {Object} queue json.
   * @return {boolean} whether further queues should be checked now.
   */
  onMatch(queue) {
    if (this.isPassed(queue)) {
      if (this.d) this.log('Already passed '+queue.name+'.');
      if (this.extra == 'CLEAR') {
        const val=this.getCookie(QueueFairAdapter.cookieNameBase+queue.name);
        if (this.d) this.log('Clear receieved - cookie is '+val);
        if (''!==val) {
          this.setCookie(queue.name, val, 20, queue.cookieDomain);
        } else {
          return true;
        }
      } else {
        return true;
      }
    }
    if (this.d) this.log('Checking at server '+queue.displayName);
    this.consultAdapter(queue);
    return false;
  }

  /** Checks if a queue has been passed already.
   * @param {Object} queue json
   * @return {boolean} true if passed.
   */
  isPassed(queue) {
    if (this.passed[queue.name]) {
      if (this.d) this.log('Queue '+queue.name+' marked as passed already.');
      return true;
    }
    const queueCookie=this.getCookie(QueueFairAdapter.cookieNameBase +
      queue.name);
    if (!queueCookie || queueCookie==='') {
      if (this.d) this.log('No cookie found for queue '+queue.name);
      return false;
    }
    if (!this.includes(queueCookie, queue.name)) {
      if (this.d) this.log('Cookie value is invalid for '+queue.name);
      return false;
    }

    if (!this.validateCookieWithQueue(queue, queueCookie)) {
      if (this.d) this.log('Cookie failed validation ' + queueCookie);

      this.setCookie(queue.name, '', 0, queue.cookieDomain);
      return false;
    }

    if (this.d) this.log('Got a queueCookie for '+queue.name+' '+queueCookie);
    return true;
  }

  /** Creates a SHA256 HMAC hash.
   * @param {string} secret the secret to use.
   * @param {string} message the message to sign.
   * @return {string} a hash.
   */
  createHash(secret, message) {
    return crypto.createHmac('SHA256', secret).update(message).digest('hex');
  }

  /** Processes a User-Agent for use with signature.
   * @param {string} parameter the string to process.
   * @return {string} a processed string.
   */
  processIdentifier(parameter) {
    if (parameter == null) {
      return null;
    }
    const i = parameter.indexOf('[');
    if (i == -1) {
      return parameter;
    }

    if (i < 20) {
      return parameter;
    }
    return parameter.substring(0, i);
  }


  /** Called to validate a cookie.  May be called externally
   * (Hybrid Security Model).
   * @param {Object} queue json
   * @param {string} cookie the cookie value to validate
   * @return {boolean} whether it's valid
   */
  validateCookieWithQueue(queue, cookie) {
    return this.validateCookie(queue.secret,
        queue.passedLifetimeMinutes, cookie);
  }


  /** Called to validate a cookie.  May be called externally
   * (Hybrid Security Model).
   * @param {string} secret the queue secret.
   * @param {number} passedLifetimeMinutes the maximum allowed
   * lifetime in minutes.
   * @param {string} cookie the cookie value to validate
   * @return {boolean} whether it's valid
   */
  validateCookie(secret, passedLifetimeMinutes, cookie) {
    if (this.d) this.log('Validating cookie ' + cookie);

    if (cookie == null || ''==cookie) {
      return false;
    }
    try {
      const parsed = this.strToPairs(cookie);
      if (parsed['qfh'] == null) {
        return false;
      }

      const hash = parsed['qfh'];

      const hpos = cookie.lastIndexOf('qfh=');
      const check = cookie.substring(0, hpos);

      const checkHash = this.createHash(secret,
          this.processIdentifier(this.userAgent)+check);

      if (hash != checkHash) {
        if (this.d) {
          this.log('Cookie Hash Mismatch Given ' +
          hash + ' Should be ' + checkHash);
        }

        return false;
      }

      let tspos = parsed['qfts'];

      tspos = parseInt(tspos);

      if (!Number.isInteger(tspos)) {
        if (this.d) this.log('Cookie bad timestamp ' + tspos);
        return false;
      }

      if (tspos < this.time() - (passedLifetimeMinutes * 60)) {
        if (this.d) {
          this.log('Cookie timestamp too old ' +
          (this.time() - tspos));
        }
        return false;
      }
      if (this.d) this.log('Cookie Validated ');
      return true;
    } catch (err) {
      if (this.d) this.log('Cookie validation failed with error '+err);
    }
    return false;
  }

  /** Parses a query string into an array of key-value pairs.
   * @param {string} str the query string.
   * @return {Array} the array of pairs.
   */
  strToPairs(str) {
    const q = [];

    const vars = str.split('&');

    for (let i = 0; i < vars.length; i++) {
      const pair = vars[i].split('=');
      if (pair.length > 1) {
        q[pair[0]] = decodeURIComponent(pair[1]);
      }
    }
    return q;
  }

  /** Convenience method
   * @return {number} epoch time in seconds.
   */
  time() {
    return Date.now()/1000;
  }

  /** Checks if a Passed String is valid.
   * @param {Object} queue json
   * @return {boolean} whether it's valid or not.
   */
  validateQuery(queue) {
    try {
      const i = this.url.indexOf('?');
      if (i == -1) {
        return false;
      }

      let str = this.url.substring(i);
      if ('?' == str) {
        return false;
      }

      str = str.substring(1);
      const hpos = str.lastIndexOf('qfh=');

      if (hpos == -1) {
        if (this.d) this.log('No Hash In Query');
        return false;
      }

      if (this.d) this.log('Validating Passed Query ' + str);

      const qpos = str.lastIndexOf(str, 'qfqid=');

      if (qpos === -1) {
        if (this.d) this.log('No Queue Identifier');
        return false;
      }

      const q = this.strToPairs(str);

      const queryHash = q['qfh'];

      if (!queryHash) {
        if (this.d) this.log('Malformed hash');
        return false;
      }

      // const queryQID = q['qfqid'];
      let queryTS = q['qfts'];
      // const queryAccount = q['qfa'];
      // const queryQueue = q['qfq'];
      // const queryPassType = q['qfpt'];

      if (queryTS == null) {
        if (this.d) this.log('No Timestamp');
        return false;
      }

      queryTS = parseInt(queryTS);

      if (!Number.isInteger(queryTS)) {
        if (this.d) this.log('Timestamp '+queryTS+' Not Numeric');
        return false;
      }

      if (queryTS > this.time() + this.config.queryTimeLimitSeconds) {
        if (this.d) this.log('Too Late ' + queryTS + ' ' + this.time());
        return false;
      }

      if (queryTS < this.time() - this.config.queryTimeLimitSeconds) {
        if (this.d) this.log('Too Early ' + queryTS + ' ' + this.time());
        return false;
      }

      const check = str.substring(qpos, hpos);

      const checkHash = this.createHash(queue.secret,
          this.processIdentifier(this.userAgent) + check);

      if (checkHash != queryHash) {
        if (this.d) this.log('Failed Hash '+checkHash);
        return false;
      }

      return true;
    } catch (err) {
      if (this.d) this.log('Query validation failed with error '+err);
      return false;
    }
    return true;
  }

  /** Called to set the UID from a cookie if present. */
  setUIDFromCookie() {
    const cookieBase = 'QueueFair-Store-' + this.config.account;

    const uidCookie = this.getCookie(cookieBase);
    if (uidCookie == '') {
      return;
    }

    let i = uidCookie.indexOf(':');
    if (i == -1) {
      i = uidCookie.indexOf('=');
    }

    if (i == -1) {
      if (this.d) this.log('= not found in UID Cookie! ' + uidCookie);
      this.uid = uidCookie;
      return;
    }

    this.uid = uidCookie.substring(i + 1);
    if (this.d) this.log('UID set to ' + this.uid);
  }

  /** Gets a cookie
   * @param {string} cname the name of the cookie
   * @return {string} the cookie value, or '' if not found.
   */
  getCookie(cname) {
    if (cname==='' || cname===null) {
      return '';
    }
    const val = this.service.getCookie(cname);
    if (val === null) {
      return '';
    }
    return val;
  }

  /** Called when settings as a string have been found
   * @param {string} data the settings as a json object
   */
  gotSettingsStr(data) {
    try {
      const json = JSON.parse(data);
      QueueFairAdapter.memSettings = json;
      QueueFairAdapter.lastMemSettingsRead = Date.now();
      this.gotSettings(QueueFairAdapter.memSettings);
    } catch (err) {
      this.releaseGetting();
      this.errorHandler(err);
    }
  }

  /** Called when settings have been found
   * @param {Object} json the settings as a json object
   */
  gotSettings(json) {
    this.releaseGetting();
    if (this.d) this.log('Got settings '+JSON.stringify(json));
    this.settings=json;
    try {
      if (this.d) this.log('Got client settings.');
      this.checkQueryString();
      if (!this.continuePage) {
        return;
      }
      this.parseSettings();
    } catch (err) {
      this.log('QF Error ');
      this.errorHandler(err);
    }
  }

  /** Parses the settings to see if we have a match,
   * and act upon any match found. */
  parseSettings() {
    try {
      if (!this.settings) {
        if (this.d) this.log('ERROR: Settings not set.');
        return;
      }
      const queues=this.settings.queues;
      if (!queues || !queues[0]) {
        if (this.d) this.log('No queues found.');
        return;
      }
      this.parsing=true;
      if (this.d) this.log('Running through queue rules');
      for (let i=0; i<queues.length; i++) {
        const queue=queues[i];
        if (this.passed[queue.name]) {
          if (this.d) {
            this.log('Already passed ' + queue.displayName +
            ' ' + this.passed[queue.name]);
          }
          continue;
        }
        if (this.d) this.log('Checking '+queue.displayName);
        if (this.isMatch(queue)) {
          if (this.d) this.log('Got a match '+queue.displayName);
          if (!this.onMatch(queue)) {
            if (this.consultingAdapter) {
              return;
            }
            if (!this.continuePage) {
              return;
            }
            if (this.d) {
              this.log('Found matching unpassed queue ' +
              queue.displayName);
            }
            if (this.config.adapterMode == 'simple') {
              return;
            } else {
              continue;
            }
          }

          if (!this.continuePage) {
            return;
          }
          // Passed
          this.passed[queue.name] = true;
        } else {
          if (this.d) this.log('Rules did not match '+queue.displayName);
        }
      }
      if (this.d) this.log('All queues checked.');
      this.parsing=false;
    } catch (err) {
      this.errorHandler(err);
    } finally {
      if (!this.consultingAdapter) {
        this.finish();
      }
    }
  }

  /** Launches a call to the Adapter Servers
   * @param {Object} queue json
   */
  consultAdapter(queue) {
    if (this.d) {
      this.log('Consulting Adapter Server for queue ' +
      queue.name +' for page '+this.url);
    }

    this.adapterQueue = queue;
    let adapterMode = 'safe';

    if (queue.adapterMode != null) {
      adapterMode = queue.adapterMode;
    } else if (this.config.adapterMode != null) {
      adapterMode = this.config.adapterMode;
    }

    if (this.d) {
      this.log('Adapter mode is ' + adapterMode);
    }

    if ('safe' == adapterMode) {
      let url = this.protocol + '://' + queue.adapterServer + '/adapter/' + queue.name;
      url += '?ipaddress=' + encodeURIComponent(this.service.remoteAddr());
      if (this.uid != null) {
        url += '&uid=' + this.uid;
      }

      url += '&identifier=';
      url += encodeURIComponent(this.processIdentifier(this.userAgent));

      if (this.d) this.log('Adapter URL ' + url);
      this.consultingAdapter = true;
      this.loadURL(url, (data) => this.gotAdapterStr(data));
      return;
    }

    // simple mode.
    let url = this.protocol + '://' + queue.queueServer + '/' + queue.name + '?target=' + encodeURIComponent(this.url);

    url = this.appendVariant(queue, url);
    url = this.appendExtra(queue, url);
    if (this.d) this.log('Redirecting to adapter server ' + url);
    this.redirectLoc = url;
    this.redirect();
  }

  /** appends ? or & appropriately.
   * @param {string} redirectLoc the URL to redirect.
   * @return {string} the redirect location.
   */
  appendQueryOrAmp(redirectLoc) {
    if (redirectLoc.indexOf('?') != -1) {
      redirectLoc+='&';
    } else {
      redirectLoc+='?';
    }
    return redirectLoc;
  }

  /** Finds and appends any variant to the redirect location
   * @param {Object} queue json
   * @param {string} redirectLoc the URL to redirect.
   * @return {string} the location with variant appended if found.
   */
  appendVariant(queue, redirectLoc) {
    if (this.d) this.log('Looking for variant');
    const variant=this.getVariant(queue);
    if (variant === null) {
      if (this.d) this.log('No Variant Found');
      return redirectLoc;
    }
    if (this.d) this.log('Found variant '+variant);
    redirectLoc=this.appendQueryOrAmp(redirectLoc);
    redirectLoc+='qfv='+encodeURIComponent(variant);
    return redirectLoc;
  }

  /** appends any Extra data to the redirect location
   * @param {Object} queue json
   * @param {string} redirectLoc the URL to redirect.
   * @return {string} the location with extra appended.
   */
  appendExtra(queue, redirectLoc) {
    if (this.extra===null || this.extra==='') {
      return redirectLoc;
    }
    redirectLoc=this.appendQueryOrAmp(redirectLoc);
    redirectLoc+='qfx='+encodeURIComponent(this.extra);
    return redirectLoc;
  }

  /** Looks through the rules to see if a variant matches.
   * @param {Object} queue the queue json
   * @return {string} the name of the variant, or null if none match.
   */
  getVariant(queue) {
    if (this.d) this.log('Getting variants for '+queue.name);
    if (!queue.activation) {
      return null;
    }
    const variantRules=queue.activation.variantRules;
    if (!variantRules) {
      return null;
    }
    if (this.d) this.log('Got variant rules for '+queue.name);
    for (let i=0; i<variantRules.length; i++) {
      const variant=variantRules[i];
      const variantName=variant.variant;
      const rules=variant.rules;
      const ret = this.isMatchArray(rules);
      if (this.d) this.log('Variant match '+variantName+' '+ret);
      if (ret) {
        return variantName;
      }
    }
    return null;
  }

  /** Called in "safe" mode when an adapter call has returned content
   * @param {string} data the content.
   * */
  gotAdapterStr(data) {
    this.consultingAdapter=false;
    try {
      this.adapterResult = JSON.parse(data);
      this.gotAdapter();
    } catch (err) {
      errorHandler(err);
    }
  }

  /** Called in "safe" mode when an adapter call has returned json */
  gotAdapter() {
    try {
      if (this.d) {
        this.log('Got from adapter ' +
        JSON.stringify(this.adapterResult));
      }
      if (!this.adapterResult) {
        if (this.d) this.log('ERROR: onAdapter() called without result');
        return;
      }

      if (this.adapterResult.uid != null) {
        if (this.uid != null && this.uid != this.adapterResult.uid) {
          this.log('UID Cookie Mismatch - Contact Queue-Fair Support! ' +
            'expected ' + this.uid + ' but received ' + this.adapterResult.uid);
        } else {
          this.uid = this.adapterResult.uid;
          this.service.setCookie('QueueFair-Store-' +
            this.config.account, 'u:' +
            this.uid, this.adapterResult.cookieSeconds,
          '/', this.adapterQueue.cookieDomain);
        }
      }

      if (!this.adapterResult.action) {
        if (this.d) this.log('ERROR: onAdapter() called without result action');
      }

      if (this.adapterResult.action=='SendToQueue') {
        if (this.d) this.log('Sending to queue server.');

        let queryParams='';
        const winLoc = this.url;
        if (this.adapterQueue.dynamicTarget != 'disabled') {
          queryParams+='target=';
          queryParams+=encodeURIComponent(winLoc);
        }
        if (this.uid != null) {
          if (queryParams != '') {
            queryParams += '&';
          }
          queryParams += 'qfuid=' + this.uid;
        }

        let redirectLoc = this.adapterResult.location;
        if (queryParams!=='') {
          redirectLoc=redirectLoc+'?'+queryParams;
        }
        redirectLoc=this.appendVariant(this.adapterQueue, redirectLoc);
        redirectLoc=this.appendExtra(this.adapterQueue, redirectLoc);

        if (this.d) this.log('Redirecting to '+redirectLoc);
        this.redirectLoc=redirectLoc;
        this.redirect();
        return;
      }
      if (this.adapterResult.action=='CLEAR') {
        if (this.d) this.log('CLEAR received for '+this.adapterResult.queue);
        this.passed[this.adapterResult.queue]=true;
        if (this.parsing) {
          this.parseSettings();
        }
        return;
      }

      // SafeGuard etc
      this.setCookie(this.adapterResult.queue,
          this.adapterResult.validation,
          this.adapterQueue.passedLifetimeMinutes*60,
          this.adapterQueue.cookieDomain);

      if (this.d) {
        this.log('Marking ' +
        this.adapterResult.queue + ' as passed by adapter.');
      }

      this.passed[this.adapterResult.queue]=true;

      if (this.parsing) {
        this.parseSettings();
      }
    } catch (err) {
      if (this.d) this.log('QF Error '+err.message);
      this.errorHandler(err);
    }
  }

  /** Redirects the browser.
   */
  redirect() {
    // Either Queue-Fair redirects, or the page continues.
    this.continuePage = false;
    this.service.redirect(this.redirectLoc);
    this.finish();
  }

  /** Sets a Passed Cookie
   *
   * @param {string} queueName the name of the queue.
   * @param {string} value the Passed String to store.
   * @param {number} lifetimeSeconds how long the cookie should persist.
   * @param {string} cookieDomain optional domain - otherwise
   * the page's domain is used.
   */
  setCookie(queueName, value, lifetimeSeconds, cookieDomain) {
    if (this.d) {
      this.log('Setting cookie for ' +
      queueName + ' to ' + value + ' on ' + cookieDomain);
    }

    const cookieName=QueueFairAdapter.cookieNameBase+queueName;

    this.service.setCookie(cookieName, value,
        lifetimeSeconds, '/', cookieDomain);

    if (lifetimeSeconds <= 0) {
      return;
    }

    this.passed[queueName] = true;
    if (this.config.stripPassedString) {
      const loc = this.url;
      const pos = loc.indexOf('qfqid=');
      if (pos == -1) {
        return;
      }
      if (this.d) this.log('Striping passedString from URL');
      this.redirectLoc = loc.substring(0, pos - 1);
      this.redirect();
    }
  }

  /** Get the content of a URL and call next as a callback.
   *
   * @param {string} urlStr the url as a string
   * @param {function} next the callback
   */
  loadURL(urlStr, next) {
    const url = new URL(urlStr);
    let path = url.pathname;
    if (url.search != null) {
      path+=url.search;
    }
    const options = {
      hostname: url.hostname,
      protocol: url.protocol,
      port: url.port,
      path: path,
      rejectUnauthorized: false,
      method: 'GET',
    };
    this.doRequest(urlStr, options).then((data) => next(data));
  }

  /** Unsets flags that indicate an http request is in progress.
   */
  releaseGetting() {
    if (this.thisIsGettingSettings) {
      this.thisIsGettingSettings = false;
      QueueFairAdapter.gettingSettings = false;
    }
    if (this.consultingAdapter) {
      this.consultingAdapter = false;
    }
  }

  /** Perform an http request..
   *
   * @param {string} url the url to fetch
   * @param {Object} options for the http/https module.
   * @return {Object} a promise to do the request.
   */
  doRequest(url, options) {
    if (this.d) this.log(url);
    return new Promise((resolve, reject) => {
      let what = https;
      if (options.protocol == 'http:') {
        what = http;
      }
      const req = what.request(url, options, (res) => {
        if (this.d) this.log('Response code: '+res.statusCode);
        if (res.statusCode != 200) {
          releaseGetting();
          return reject(new Error('stauscode='+res.statusCode));
        }
        let responseBody = '';
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          resolve(responseBody);
        });
      });

      req.on('error', (err) => {
        releaseGetting();
        errorHandler(err);
        reject(err);
      });

      req.end();
    });
  }


  /** Convenience logging method
   *
   * @param {Object} what the thing to log.
   */
  log(what) {
    console.log('QF '+what);
  }


  /** Gets settings from the memory cache or downloads a fresh
   * copy.  Only one request at a time may attempt the download.
   * Other requests may wait for up to config.readTimeout before
   * trying themselves.
   *
   * */
  loadSettings() {
    if (QueueFairAdapter.memSettings != null &&
      QueueFairAdapter.lastMemSettingsRead != -1 &&
      Date.now() - QueueFairAdapter.lastMemSettingsRead <
        this.config.settingsCacheLifetimeMinutes * 60 *1000) {
      // Old settings are good.
      if (this.d) this.log('Using cached settings.');
      this.gotSettings(QueueFairAdapter.memSettings);
      return;
    }

    if (QueueFairAdapter.gettingSettings &&
        this.settingsCounter < this.config.readTimeout) {
      if (this.d) this.log('Waiting for settings.');
      this.settingsCounter++;
      setTimeout(() =>
        this.loadSettings(), 1000);
    }

    if (this.d) this.log('Downloading settings.');
    QueueFairAdapter.gettingSettings = true;
    this.thisIsGettingSettings = true;
    this.loadURL('https://files.queue-fair.net/' +
      this.config.account +
      '/' +
      this.config.accountSecret +
      '/queue-fair-settings.json', (data) => this.gotSettingsStr(data));
  }

  /** Retrieve the query string from the url.
   *
   * @return {string} the query string.
   * */
  getQueryString() {
    if (this.url == null) {
      return '';
    }
    const i = this.url.indexOf('?');
    if (i==-1) {
      return '';
    }
    return this.url.substring(i);
  }

  /** Checks if a Passed String is present and sets the Passed Cookie. */
  checkQueryString() {
    const urlParams = this.url;
    if (this.d) this.log('Checking URL for Passed String ' + urlParams);
    const q = urlParams.lastIndexOf('qfqid=');
    if (q === -1) {
      return;
    }

    if (this.d) this.log('Passed string found');

    let i = urlParams.lastIndexOf('qfq=');
    if (i == -1) {
      return;
    }
    if (this.d) this.log('Passed String with Queue Name found');


    const j = urlParams.indexOf('&', i);
    const subStart = i + 'qfq='.length;
    const queueName = urlParams.substring(subStart, j);

    if (this.d) this.log('Queue name is ' + queueName);
    const lim = this.settings.queues.length;


    for (i = 0; i < lim; i++) {
      const queue = this.settings.queues[i];
      if (queue.name != queueName) {
        continue;
      }

      if (this.d) this.log('Found queue for querystring ' + queueName);

      let value = '' + urlParams;
      value = value.substring(value.lastIndexOf('qfqid'));

      if (!this.validateQuery(queue)) {
        // This can happen if it's a stale query string too
        // so check for valid cookie.
        const queueCookie = this.getCookie(QueueFairAdapter.cookieNameBase +
          queueName);
        if ('' != queueCookie) {
          if (this.d) {
            this.log('Query validation failed but we have cookie ' +
            queueCookie);
          }

          if (this.validateCookieWithQueue(queue, queueCookie)) {
            if (this.d) this.log('...and the cookie is valid. That\'s fine.');
            return;
          }
          if (this.d) this.log('Query AND Cookie validation failed!!!');
        } else {
          if (this.d) {
            this.log('Bad queueCookie for ' +
            queueName + ' ' + queueCookie);
          }
        }

        const loc = this.protocol + '://' + queue.queueServer + '/' +
          queue.name + '?qfError=InvalidQuery';

        if (this.d) {
          this.log('Query validation failed - ' +
          ' redirecting to error page.');
        }
        this.redirectLoc = loc;
        this.redirect();
        return;
      }

      if (this.d) {
        this.log('Query validation succeeded for ' + value);
      }
      this.passedString = value;

      this.setCookie(
          queueName,
          value,
          queue.passedLifetimeMinutes * 60,
          queue.cookieDomain);
      if (!this.continuePage) {
        return;
      }

      if (this.d) {
        this.log('Marking ' + queueName + ' as passed by queryString');
      }
      this.passed[queueName] = true;
    }
  }


  /** Called if an irrecoverable error occurs.
   *
   * @param {Object} err an error
   * */
  errorHandler(err) {
    this.releaseGetting();
    console.log('QF Ending with error:');
    console.log(err);
    this.finish();
  }

  /** run some initial setup and checks.
   *
   * @return {boolean} whether the adapter should proceed.
   * */
  setUp() {
    if (this.startsWith(this.config.account, 'DELETE')) {
      this.errorHandler('You must set your account system name in config.');
      return false;
    }
    if (this.startsWith(this.config.accountSecret, 'DELETE')) {
      this.errorHandler('You must set your account secret in config.');
      return false;
    }
    if (this.url == null) {
      this.errorHandler('You must set adapter.url before running the Adapter.');
      return false;
    }
    if (this.userAgent == null) {
      this.errorHandler('You must set adapter.userAgent ' +
        'before running the Adapter.');
      return false;
    }
    if (!this.startsWith(this.url, 'https')) {
      this.protocol = 'http';
    }
    return true;
  }

  /** Start by retrieving settngs. */
  goGetSettings() {
    try {
      if (this.d) this.log('Adapter starting Async for '+this.url);
      if (!this.setUp()) {
        return;
      }
      if (this.config.readTimeout < 1) {
        this.config.readTimeout = 1;
      }
      this.setUIDFromCookie();
      this.loadSettings();
    } catch (err) {
      this.releaseGetting();
      this.errorHandler(err);
    }
  }

  /** Alternative entry point if async functions cannot be used
   * @param {string} settingsStr a string of json.
   * @return {boolean} whether execution of the page should continue.
   * */
  goSimpleModeWithSettings(settingsStr) {
    this.config.adapterMode='simple';
    if (this.d) this.log('Adapter starting for '+this.url);
    if (!this.setUp()) {
      return;
    }
    try {
      this.setUIDFromCookie();

      // for testing
      // settingsStr = JSON.stringify(QueueFairAdapter.memSettings);

      // Really do this.
      const settings = JSON.parse(settingsStr);
      this.gotSettings(settings);
    } catch (err) {
      this.errorHandler(err);
    }
    return this.continuePage;
  }

  /** The main entry point
   *
   * @return {Object} a promise.
   * */
  go() {
    return new Promise((res, rejPromise) => {
      this.res = res;
      this.timeout=setTimeout(() => {
        this.onTimeout();
      }, this.config.readTimeout*1000);
      this.goGetSettings();
    });
  }

  /** Called if it doesn't finish in time. */
  onTimeout() {
    if (this.finished) {
      return;
    }
    this.log('QF Timed Out!');
    this.finished=true;
    if (this.res != null) {
      this.res(this.continuePage);
    }
  }

  /** Called when it's finished to fill the promise */
  finish() {
    if (this.finished) {
      return;
    }
    clearTimeout(this.timeout);
    this.finished=true;
    if (this.res != null) {
      this.res(this.continuePage);
    }
  }
}
