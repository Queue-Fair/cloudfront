'use strict';
// Your Account Secret is shown on the Your Account page of
// the Queue-Fair Portal.If you change it there, you must
// change it here too.
exports.accountSecret='DELETE THIS TEXT AND REPLACE WITH YOUR ACCOUNT SECRET';

// The System Name of your account from the Your Account page
// of the Queue-Fair Portal.
exports.account ='DELETE THIS TEXT AND REPLACE WITH YOUR ACCOUNT SYSTEM NAME';

// Leave this set as is
exports.filesServer='files.queue-fair.net';

// Time limit for Passed Strings to be considered valid,
// before and after the current time
exports.queryTimeLimitSeconds=30;

// Valid values are true, false, or an "IP_address".
exports.debug=true;

// How long to wait in seconds for network reads of config
// or Adapter Server (safe mode only)
exports.readTimeout=5;

// How long a cached copy of your Queue-Fair settings will be kept before
// downloading a fresh copy.Set this to 0 if you are updating your settings in
// the Queue-Fair Portal and want to test your changes quickly, but remember
// to set it back again when you are finished to reduce load on your server.
exports.settingsCacheLifetimeMinutes=5;

// Whether or not to strip the Passed String from the URL
// that the Visitor sees on return from the Queue or Adapter servers
// (simple mode) - when set to true causes one additinal HTTP request
// to your site but only on the first matching visit from a particular
// visitor. The recommended value is true.
exports.stripPassedString=true;

// Whether to send the visitor to the Adapter server for counting (simple mode),
// or consult the Adapter server (safe mode).The recommended value is "safe".
exports.adapterMode = 'safe';
