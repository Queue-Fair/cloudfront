const queueFair = require('./queue-fair');

exports.handler = async(event) => {

    const req = event.Records[0].cf.request;
    try {
        const ret = await goQueueFair(req);
        if(queueFair.config.debug) {
            console.log("QF REQ RETURNING",JSON.stringify(ret));
        }
        return ret;
    } catch (error) {
        console.log("QF ERROR",error);
        return req;
    }
}

async function goQueueFair(req) {
  queueFair.config.account='REPLACE THIS WITH YOUR ACCOUNT SYSTEM NAME FROM THE PORTAL';
  queueFair.config.accountSecret='REPLACE THIS WITH YOUR ACCOUNT SECRET FROM THE PORTAL';

  //Lambda@edge functions do not know the client's protocol, so
  //this must be hard coded.  Setting this to https will mean that
  //any URLS from Dynamic Targeting will be secure, and also any
  //cookies set by Queue-Fair are secure.
  const protocol = "https";

  // Uncomment the below two lines when testing.
  // queueFair.config.debug=true;
  // queueFair.config.settingsCacheLifetimeMinutes = 0;

  //Don't modify any of the below.
  if(queueFair.config.debug) {
    console.log("QF REQ is",JSON.stringify(req));
  }
  const service = queueFair.service(req);
  service.isSecure = (protocol == "https");
  const adapter = queueFair.adapter(queueFair.config, service);
  adapter.url = protocol + "://" + req.headers.host[0].value
    + req.uri+(req.querystring != "" ? "?" + req.querystring : "" );
  adapter.userAgent = req.headers['user-agent'][0].value;

  if (!await adapter.go()) {
    // Adapter says No - do not generate page.
    if(service.redirectLoc == null) {
        console.log("QF WARNING: Queue-Fair returned stop but no redirect!");
        return req;
    }
    const resp = {
        status: "302",
        headers: {
            'location' : [{key: 'location', value: service.redirectLoc}]
        }
    };
    //Cookies and cache control are set on the response directly.
    service.addCookiesTo(resp,false);
    service.setNoCache(resp,false);
    return resp;
  }

  // Page should continue. Any cache-control or cookies
  // set by Queue-Fair do not materially affect the request
  // but are applied to the response by the ViewerResponse
  // lambda.
  service.addCookiesTo(req,true);
  service.setNoCache(req,true);
  return req;
}