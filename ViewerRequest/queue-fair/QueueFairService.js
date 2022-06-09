module.exports = {
  service: function(req, res) {
    return new QueueFairService(req, res);
  },
};

/** Class encapsulating low-level functions */
class QueueFairService {
  req;
  cookies = null;
  addedCookies = null;
  doneNoCache = false;
  redirectLoc = null;
  isSecure = false;

  /**
   * @param {Object} req a CloudFront request
   */
  constructor(req) {
    this.req= req;
  }

  parseCookies() {
    this.cookies = [];
    if (this.req.headers.cookie) {
        this.req.headers.cookie[0].value.split(';').forEach((c) => {
            if (c) {
                let i = c.indexOf("=");
                try {
                  let key = c.substring(0,i).trim();
                  let value = c.substring(i+1).trim();
                  this.cookies[key] = value;
                } catch (error) {
                  //Do nothing.
                }
            }
        });
    }
  }

  /**
   * @param {string} cname the name of the cookie.
   * @return {string} the cookie value, or null if not found.
   */
  getCookie(cname) {
    if(this.cookies == null) {
      this.parseCookies();
    }
    if(typeof this.cookies[cname] !== "undefined") {
      return this.cookies[cname];
    }
    return null;
  }

  /**
   * @param {string} cname the full name of the cookie.
   * @param {string} value the value to store.
   * @param {string} lifetimeSeconds how long the cookie persists
   * @param {string} path the cookie path
   * @param {string} cookieDomain optional cookie domain.
   */
  setCookie(cname, value, lifetimeSeconds, path, cookieDomain) {
    this.noCache();
    if(this.addedCookies == null) {
      this.addedCookies = [];
    }

    var v = value+";Max-Age="+lifetimeSeconds;

    let date=new Date();
    date.setTime(date.getTime()+lifetimeSeconds*1000);
    v += ";Expires="+date.toUTCString();
    if(cookieDomain != null && cookieDomain != "") {
      v+=";Domain="+cookieDomain;
    }
    v+=";Path="+path;
    this.addedCookies[cname] = v;
  }

  /**
   * Sets no-cache headers if needed.
   */
  noCache() {
    if (this.doneNoCache) {
      return;
    }
    this.doneNoCache=true;
  }

  /**
   * @param {string} loc where to send the visitor. 302 redirect.
   */
  redirect(loc) {
    this.noCache();
    this.redirectLoc = loc;
  }

  /**
   * @return {string} the IP address of the visitor
   */
  remoteAddr() {
    return this.req.clientIP;
  }

  /**
   * @param {Object} obj the JSON object to which to add the cookies.
   * @param {boolean} save whether to save the values to be added later, or set them directly with set-cookie header.
   */
  addCookiesTo(obj, save) {
    if(this.addedCookies == null) {
      return;
    }

    let arr = [];

    let headerName = save ? 'x-qf-cookie' : 'set-cookie';

    if(!save && obj['headers'][headerName]){
      for(var cookie of obj['headers'][headerName]){
        arr.push(cookie.value);
      }
    }

    for(var key in this.addedCookies) {
      var val = this.addedCookies[key];
      arr.push(key+"="+val+(this.isSecure ? ";Secure;SameSite=None" : ""));
    }

    obj['headers'][headerName] = [{
    'key': headerName,
    'value': arr
    }];
  }

  /**
   * @param {Object} obj the JSON object on which to set the cache-control.
   * @param {boolean} save whether to save the value to be set later, or set directly with cache-control header.
   */
  setNoCache(obj,save) {
    if(!this.doneNoCache) {
      return;
    }
    let headerName = save ? 'x-qf-cache' : 'cache-control';
    obj.headers[headerName] = [{"key" : headerName , "value" : "no-store,no-cache,max-age=0"}];
  }
}
