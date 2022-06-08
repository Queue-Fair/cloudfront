---
## Queue-Fair Virtual Waiting Room CloundFront Adapter for AWS CloudFront sites README & Installation Guide

Queue-Fair can be added to any web server easily in minutes.  You will need a Queue-Fair account - please visit https://queue-fair.com/free-trial if you don't already have one.  You should also have received our Technical Guide.

## Client-Side JavaScript Adapter

Most of our customers prefer to use the Client-Side JavaScript Adapter, which is suitable for all sites that wish solely to protect against overload.

To add the Queue-Fair Client-Side JavaScript Adapter to your web server, you don't need the files included in this distribution.

Instead, add the following tag to the `<head>` section of your pages:
 
```
<script data-queue-fair-client="CLIENT_NAME" src="https://files.queue-fair.net/queue-fair-adapter.js"></script>`
```

Replace CLIENT_NAME with the account system name visibile on the Account -> Your Account page of the Queue-Fair Portal

You shoud now see the Adapter tag when you perform View Source after refreshing your pages.

And you're done!  Your queues and activation rules can now be configured in the Queue-Fair Portal.

## CloudFront Adapter
Using the CloudFront Adapter means that your CloudFront distribution communicates directly with the Queue-Fair Queue Server Cluster, rather than your visitors' browsers or your origin server.

This can introduce a dependency between our systems, which is why most customers prefer the Client-Side Adapter.  See Section 10 of the Technical Guide for help regarding which integration method is most suitable for you.

The CloudFront Adapter is a small Node.js library that will run on CloudFront when visitors make requests served by CloudFront.  It is implemented as two Lambda@Edge functions, one that listens for ViewerRequest triggers (that does most of the work), and a second one to process ViewerResponse events (that doesn't do much).  You must install BOTH lambda functions on your CloudFront distribution for the adapter to work.  It is adapted from our cross-platform node adapter; the only changes are to the QueueFairService.js file, which is the one that's meant to have any platform specific code, as designed.

The Adapter periodically checks to see if you have changed your Queue-Fair settings in the Portal, and caches the result in memory, but other than that if the visitor is requesting a page that does not match any queue's Activation Rules, it does nothing.

If a visitor requests a page that DOES match any queue's Activation Rules, the Adapter consults the Queue-Fair Queue Servers to make a determination whether that particular visitor should be queued.  If so, the visitor is sent to our Queue Servers and execution and generation of the page for that HTTP request for that visitor will cease, and your origin server will not receive a request.  If the Adapter determines that the visitor should not be queued, it sets a cookie to indicate that the visitor has been processed and your CloudFront will return a page from its cache or contact your origin server as normal.

Thus the CloudFront Adapter prevents visitors from skipping the queue by disabling the Client-Side JavaScript Adapter, and also eliminates load on your origin server when things get busy.

These instructions assume you already have a CloudFront distribution with an origin server set up.  If that's not the case, or you want to create a new distribution to test this Adapter, get an EC2 instance in the AWS Free Tier, install a webserver on it, and create a CloudFront distribution with the Origin Domain set to your EC2's Public IPv4 DNS that you can see by clicking on the Instance ID in your list of EC2s in the EC2 Dashboard, and going to the Networking tab.  You should test that your CloudFront distribution is working in a browser before proceeding.  The instructions below assume don't already have any Viewer Request or Viewer Response Lambda@Edge functions on your CloudFront distribution - if that's not the case read the And Finally section below before making any changes.

Here's how to add Queue-Fair to your CloudFront distribution. We'll do the ViewerResponse lambda first.

**1.** Download the latest release of this distribution and unzip it.  Log in to AWS Console and make sure that the region pulldown at the top right of the AWS Console shows N. Virgina - this is the us-east-1 region.  The Lambda@Edge functions must be created in this region.

**2.** In the search box, start typing "lambda", and select Lambda, then "Create function".

**3.** Select "Use a blueprint", and in the Blueprints search box, start typing "cloudfront", and select `Name = cloudfront-http-redirect`. A box will be added with a radio button in the top right.  Check it, and then hit Configure at the bottom right.

**4.** The Function Name can be whatever you like, we recommend `queue-fair-response`.   Check the "Create a new role from AWS policy templates" radio button, and name the role `queue-fair-adapter`.  The Policy templates should already have a box underneath it saying `Basic Lambda@Edge permissions (for CloudFront trigger)`.  You won't be able to edit the Lambda function code underneath - that's OK.  Go head and hit the orange Create Function button at the bottom.

**5.** A "Deploy to Lambda@Edge" dialog may pop up - if it does, Cancel it.

**6.** Open `ViewerResponse/index.js` from this distribution, and copy-and-paste the content into the "index.js" that you can see open in the Code Source section, completely replacing any content you can see there.  Hit CTRL-S to save, and then the white Deploy button next to the orange Test button.

**7.** Scroll up to the `Function overview` section and expand it if necessary.  Select Add Trigger, and start typing "cloudfront".  Select `CloudFront` and then `Deploy to Lambda@Edge`

**8.** In the dialog that appears, select the Distribution to which you wish to add Queue-Fair from the first box.  For Cache behaviour, the default value is `*` which is fine, but will mean that the Adapter runs on all requests through CloudFront, including subrequests for assets used by your pages.  If you have a Cache behaviour that matches only page requests (and not ancilliary files like jpegs etc) then this is more efficient.  For `CloudFront event`, you *MUST* select `Viewer Response`.  Check the `Confirm deploy to Lambda@Edge` checkbox, and hit the Deploy button.  You should get a green box saying that version 1 of the function has been created and associated with a CloudFront trigger.  It won't become active right away - your CloudFront distribution will take at least a few minutes to (re)deploy.

**9.** You're done with the Viewer Response lambda.  Now it's time to create and deploy the Viewer Request lambda.  In the breadcrumbs at the top of the page select `Lambda > Functions`.

**10.** As in Step 3 above, Create Function, Use a blueprint, start typing "cloudfront", `Name = cloudfront-http-redirect`, check the radio button, and Configure.  You can name the function whatever you like, we recommend `queue-fair-request`.  This time check the "Use an existing role" button, and start typing 'queue-fair-adapter', and select `service-role/queue-fair-adapter` when it comes up, then it's the orange Create Function button at the bottom again.

**11.** Go into the `ViewerRequest` folder from this distribution.  Hit CTRL-A to select all files (both the `index.js` file and the `queue-fair` folder), and then create a zip containing these in the top level (on Windows you can right click and then `Compress to Zip file` to do this).  Call it `ViewerRequest.zip`.  In the AWS console, select `.zip file` from the `Upload from` pulldown on the right of the Code Source editor.   Hit the `Upload` button, and upload the zip file that you just created.

**12.** In index.js, enter your Account System Name and Account Secret from the Queue-Fair Portal where indicated at the top of the `goQueueFair()` function.  Hit CTRL-S to save, then the white Deploy button as above.

**13.** Scroll up to Function overview, `Add Trigger`, and this time you *MUST* select `Viewer request` as the CloudFront event.  The default `*` Cache behaviour is fine, but again if you have a Cache behaviour that just matches your pages, it's more efficicient.  Sometimes the Deploy to Lambda@Edge dialog appears twice for no apparent reason - if that happens then fill it in again the same, with `Viewer request` as the CloudFront event.

**14.** OPTIONAL You can click the `CloudFront console` link to see the status of your distribution, which will say `Deploying` in the Last modified column.  You can hit the refresh button to find out when it has finished deploying - it will take several minutes.  You can also click on the Distribution ID and go to Behaviours, check the radio button for the Cache Policy you chose (default is `*`), hit Edit and check the Function associations for `Viewer request` and `Viewer response` if you like while you wait.

**15.** Once the `Last modified` value shows a date and time instead of `Deploying`, that's it, you're done!

### To test the CloudFront Adapter

Use a queue that is not in use on other pages, or create a new queue for testing.

#### Testing SafeGuard
Set up an Activtion Rule to match the page you wish to test.  Hit Make Live.  Go to the Settings page for the queue.  Put it in SafeGuard mode.  Hit Make Live again.  You may need to wait five minutes for the new Activation Rules to become visible to the Adapter - it only checks for new rules once every five minutes, and there is a CDN timeout of five minutes on your settings files too.

In a new Private Browsing window, visit the page on your site that matches the Activation Rules.  

 - Verify that a cookie has been created named `QueueFair-Pass-queuename`, where queuename is the System Name of your queue
 - If the Adapter is in Safe mode (the default), also verify that a cookie has been created named QueueFair-Store-accountname, where accountname is the System Name of your account (on the Your Account page on the portal).
 - If you have set the Adapter to Safe mode as described below, the `QueueFair-Store` cookie is not created.
 - Hit Refresh.  Verify that the cookie(s) have not changed their values.

#### Testing Queue
Go back to the Portal and put the queue in Demo mode on the Queue Settings page.  Hit Make Live.  Delete any QueueFair-Pass cookies from your browser.  In a new tab, visit https://accountname.queue-fair.net , and delete any QueueFair-Pass or QueueFair-Data cookies that appear there.  Refresh the page that you have visited on your site.

 - Verify that you are now sent to queue.
 - When you come back to the page from the queue, verify that a new `QueueFair-Pass-queuename` cookie has been created.
 - If the Adapter is in Safe mode, also verify that the `QueueFair-Store` cookie has not changed its value.
 - Hit Refresh.  Verify that you are not queued again.  Verify that the cookies have not changed their values.

**IMPORTANT:**  Once you are sure the CloudFront Adapter is working as expected, remove the Client-Side JavaScript Adapter tag from your pages if you were using it, and also remove any Server-Side Adapter code from your origin server if you had already installed it.

**IMPORTANT:**  Responses that contain a `Location:` header or a `Set-Cookie` header from the Adapter must not be cached!  You can check which cache-control headers are present using your browser's Inspector Network Tab.  The Adapter will set a Cache-Control header to disable browser caching if it sets a cookie or sends a redirect - but you must not override these with your own code or framework.

### For maximum security

The CloudFront Adapter contains multiple checks to prevent visitors bypassing the queue, either by tampering with set cookie values or query strings, or by sharing this information with each other.  When a tamper is detected, the visitor is treated as a new visitor, and will be sent to the back of the queue if people are queuing.

 - The CloudFront Adapter checks that Passed Cookies and Passed Strings presented by web browsers have been signed by our Queue-Server.  It uses the Secret visible on each queue's Settings page to do this.
 - If you change the queue Secret, this will invalidate everyone's cookies and also cause anyone in the queue to lose their place, so modify with care!
 - The CloudFront Adapter also checks that Passed Strings coming from our Queue Server Cluster to your site were produced within the last 30 seconds.
 - The CloudFront Adapter also checks that passed cookies were produced within the time limit set by Passed Lifetime on the queue Settings page, to prevent visitors trying to cheat by tampering with cookie expiration times or sharing cookie values.  So, the Passed Lifetime should be set to long enough for your visitors to complete their transaction, plus an allowance for those visitors that are slow, but no longer.
 - The signature also includes the visitor's USER_AGENT, to further prevent visitors from sharing cookie values.

## AND FINALLY

If you already have `Viewer request` or `Viewer response` Lambda@Edge functions, then don't follow the above instructions as you will lose them.  Instead you will need to merge the index.js code from the Adapter with your existing function(s).  You can run the Queue-Fair Viewer Response code *after* any of your own Viewer Response code - but make sure it operates on any request or response object after you have finished modifying it, and that any 'x-qf-cookie' or 'x-qf-cache' headers present in the incoming event request object are presented to the Queue-Fair Viewer response code unmodified.

Conversely, you should run the Queue-Fair Viewer Request code *before* any of your own Viewer Request code.  If the result of the `goQueueFair()` function call contains a `status` field, it is a redirect response object, and should be returned immediately without running your own Viewer Request code.  If it does not contain a `status` field, it is a request object that may have been modified by the Queue-Fair CloudFront Adapter, and your code should run on the modified request before returning it.

If your origin server is doing anything with the cookies set by Queue-Fair, please note that these will not be present on any request sent to your origin server in which the cookies are in the process of being created (so for example a page request that results in a new SafeGuard Passed Cookie, or a page request for a Target Page as someone is Passed from the front of the queue) - but you can find them in the "x-qf-cookie" header on that request instead.  On subsequent requests, after the cookies have been set, the cookies will be present in the cookie header as normal.

You can enable debug level logging in both the Viewer Request and Viewer Response Lambda@Edge functions.  Please note that the logging statements resulting from any browser request will be in the CloudWatch Log groups region closest to the browser making the request, so you will need to select that region from the pulldown at the top right of the console to see them.  You can also disable caching of your Queue-Fair Settings in the Viewer Request for testing purposes, but please don't do this on a production deployment.

If you do make any changes, such as enabling or disabling debug level logging, you have to save the file, hit Deploy and re-add the trigger in the Function Overview every time, and wait for your distribution to deploy every time.  Every time you do this, any logging statements will be in a new Log stream.

All client-modifiable settings are in `QueueFairConfig.js`, where you can also change the Adapter mode from 'safe' to 'simple' if you like.  You should never find you need to modify `QueueFairAdapter.js` - but if something comes up, please contact support@queue-fair.com right away so we can discuss your requirements.

Remember we are here to help you! The integration process shouldn't take you more than an hour - so if you are scratching your head, ask us.  Many answers are contained in the Technical Guide too.  We're always happy to help!

