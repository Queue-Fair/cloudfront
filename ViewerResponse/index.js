exports.handler = async(event) => {
    const DEBUG = false;

    //You don't need to modify any of this code.
    const req = event.Records[0].cf.request;
    const resp = event.Records[0].cf.response;

    if(DEBUG) {
        console.log("QF RESP received req",JSON.stringify(req));
        console.log("QF RESP received resp",JSON.stringify(resp));
    }

    if(req.headers["x-qf-cookie"]) {
        //Adds cookies.
        if(!resp.headers["set-cookie"]) {
            resp.headers["set-cookie"] = [];
        }
        for(var c in req.headers["x-qf-cookie"]) {
            resp.headers["set-cookie"].push({key: "Set-Cookie", value: req.headers["x-qf-cookie"][c].value})
        }
    }

    if(req.headers["x-qf-cache"]) {
        //Overrides cache-control if set by Queue-Fair
        resp.headers["cache-control"] = [{"key" : "Cache-Control", "value" : req.headers["x-qf-cache"][0].value}];
    }

    if(DEBUG) {
        console.log("QF RESP RETURNING "+JSON.stringify(resp));
    }

    return resp;
}