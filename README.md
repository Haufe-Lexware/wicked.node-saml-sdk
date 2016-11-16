# wicked.haufe.io SAML SDK

This library helps implementing Authorization Servers for federating SAML identites (SSO identities) into a wicked.haufe.io OAuth2.0 Implicit Grant Flow API implementation. It assumes your SAML IdP supports the HTTP-POST Binding and encrypted SAML Assertions.

It does the heavy lifting regarding implementing a SAML SP (Service Provider) which talks to the IdP.

You can find more information on wicked.haufe.io here:

* [Official Website wicked.haufe.io](http://wicked.haufe.io)
* [wicked.haufe.io Github repository](https://github.com/Haufe-Lexware/wicked.haufe.io)

# Usage

To install the SDK into your node.js application, run

```bash
$ npm install wicked-saml --save --save-exact
```

Please note that you will also need to inject the `wicked-sdk` when initializing the `wicked-saml` SDK; check out the `wicked-sdk` NPM package for more information: [npmjs.com/packages/wicked-sdk](https://www.npmjs.com/package/wicked-sdk).

The SDK will be kept downwards-compatible for as long as possible; it will be tried hard to make earlier versions of the SDK compatible with a later release of wicked.haufe.io, so using the `--save-exact` is a safe bet.

## Prerequisites

The `wicked-saml` package is intended for use with ExpressJS 4.x and wicked.haufe.io. It is not intended for other types of usage.

You SAML IdP needs to support the HTTP-POST-Binding and Encrypted Assertions. In some cases (like OpenAM), assertion encryption has to be **explicitly turned on** and cannot be part of the `metadata.xml`. If you receive errors static that `EncryptedAssertion` lengths is zero but was expected to be one, this may be the mistake.

## Example

```javascript
var wicked = require('wicked-sdk');
var wickedSaml = require('wicked-saml')
var async = require('async'); // another requirement for this sample

async.series([
    callback => wicked.initialize(callback),
    callback => wickedSaml.initialize(wicked, 'your-server-id', callback)
], function (err) {
    if (err)
        throw err; // or do whatever you need
    
    // start server
});
```

The single most interesting point is the string `'your-server-id'` in the above example. It relies on an an Authorization Server being registered in your wicked configuration. The `wicked-saml` will do the following thing:

* Retrieve the `/auth-server/your-server-id` information from the API (that's what the `wicked-sdk`is needed for)
* Read out the information in the `saml` properties and use that to initialize the implementation of the SAML Service Provider with that

More information can be found in the wicked documentation under [Authorization Servers](https://github.com/Haufe-Lexware/wicked.haufe.io/blob/oauth2_implicit/doc/authorization-servers.md).

A sample `your-server-id.json` file could look like this:

```json
{
  "name": "your-server-id",
  "id": "your-server-id",
  "auth": "none",
  "desc": "Authorization Server for SAML Federation",
  "url": "https://${PORTAL_NETWORK_APIHOST}/auth-server/{{apiId}}?client_id=(your app's client id)",
  "config": {
    "api": {
      "upstream_url": "http://auth-server:3005",
      "request_path": "/auth-server"
    },
    "plugins": [
      {
        "config": {
          "header_name": "Correlation-Id",
          "generator": "uuid"
        },
        "name": "correlation-id"
      }
    ]
  },
  "saml": {
    "spOptions": {
      "entity_id": "https://api.company.com/auth-server/metadata.xml",
      "assert_endpoint": "https://api.company.com/auth-server/assert",
      "nameid_format": "urn:oasis:names:tc:SAML:2.0:nameid-format:transient",
      "certificate": "-----BEGIN CERTIFICATE-----\nMIIDIDCCA...awot98FReb\n-----END CERTIFICATE-----",
      "private_key": "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBA...Vy4HpO2KPg==\n-----END RSA PRIVATE KEY-----"
    },
    "idpOptions": {
      "sso_login_url": "https://your-saml-idp.com:443/auth/SSORedirect/metaAlias/idp1",
      "certificates": [
        "-----BEGIN CERTIFICATE-----\nMIICrTCC...g8t2tGs=\n-----END CERTIFICATE-----"
      ]
    }
  }
}
```

The options which can be used can be found in the documentation of `saml2-js`, which is the library which is used "under the hood" of the `wicked-saml` package: [npmjs.com/package/saml2-js](https://www.npmjs.com/package/saml2-js).

The example properties above (when correctly filled) will work with e.g. OpenAM.

# Library description

The following functions are exported by `wicked-saml`.

### `wickedSaml.initialize(wicked, serverId, callback)`

Initialize the SAML library; calls the wicked API to retrieve information on the Authorization Server registration of the wicked configuration (see above). The `serverId` has to match the `auth-server` definition ID.

Pass your `wicked-sdk` instance to the library here; `wicked-saml` will use its `apiGet` function.

**Callback signature**: `function(err)` -- Does not return anything but an error, or `null` if successful.

### `wickedSaml.metadata()`

Returns a function which can be used directly as the `metadata.xml` end point, when using express.

```javascript
app.get('/auth-server/metadata.xml', wickedSaml.metadata());
```

### `wickedSaml.login(callback)`

Create a request identifier and login URL for redirecting to the SAML IdP.

**Example**:

```javascript
// Assume /auth-server/:apiId?client_id=3498wzio4e57648576348756345
app.get('/auth-server/:apiId', function (req, res, next) {
    req.session.apiId = req.params.apiId;
    req.session.clientId = req.query.client_id;
    wickedSaml.login(function (err, loginInfo) {
        if (err)
            return next(err);
        req.session.requestId = loginInfo.requestId;
        res.redirect(loginInfo.loginUrl);
    });
});
```

Note that there is a bunch of validity checking and security measures missing in the above code.

**Callback signature**': `function(err, loginInfo)`, whereas `loginInfo`:

```javascript
loginInfo = {
    loginUrl: 'https://...../idp1',
    requestId: '7hf5irutzerwiutzhw384765h8w47658w4f'
}
```

Use the `loginUrl` to redirect to the IdP and store the `requestId` in your session for checking when you get called back in `/assert`.

### `wickedSaml.assert(req, requestId, callback)`

Use this function to decrypt a SAML assertion. Call this from the `/assert` end point you specified in your configuration (`spOptions.assert_endpoint`):

```javascript
app.post('/auth-server/assert', function (req, res, next) {
    const requestId = req.session.requestId;
    wickedSaml.assert(req, requestId, function (err, userInfo, samlResponse) {
        if (err)
            return next(err); // More elaborate error handling if needed

        // userInfo will contain "authenticated_userid" property (most of the time)
        // If you need other things, use getAttributeValue() to retrieve from
        // the samlResponse:
        userInfo.authenticated_userid = wickedSaml.getAttributeValue(samlResponse, 'our_company_id');

        // Fill in the other values for use with the Kong Adapter, stored
        // in session (see login())
        userInfo.api_id = req.session.apiId;
        userInfo.client_id = req.session.clientId;

        // In case you need to do some authorization step (this is only authentication),
        // this is the place to do that, e.g. check for licenses for the authenticated
        // user, which could be passed on as OAuth2 scopes:
        userInfo.scope = ['some_scope', 'other_scope'];

        wicked.getRedirectUriWithAccessToken(userInfo, function (err, redirect) {
            if (err)
                return next(err);
            // Yay, done! Redirect back to web app
            res.redirect(redirect.redirect_uri);
        })
    });
});
```

**Callback signature**: `function(err, userInfo, samlResponse)`

The `userInfo` looks as follows:

```javascript
userInfo = {
    authenticated_userid: "some-id-we-found"
}
```

`wickedSaml.assert` will try to extract these two values (as needed for `getRedirectUriWithAccessToken`), but cannot guarantee it will work out. Additionally, if you have multiple fields in your SAML response which ends with `id`, any one will be picked. So it's **recommended** that you explicitly set those values manually using the `samlResponse` and the `getAttributeValue()` function (see below).

### `wickedSaml.getAttributeNames(samlResponse)`

Lists all attribute names of the `user` tag of the given SAML response (`samlRespose`). Takes the SAML response from `assert()` as an argument and returns a string array.

**Note**: The attribute names will be converted to lower case.

### `wickedSaml.getAttributeValue(samlResponse, wantedAttribute)`

Retrieve the value of an attribute in the `samlResponse`. The `wantedAttribute` parameter is not case-sensitive. If the attribute cannot be found, `null` is returned. 

### `wickedSaml.getConfig()`

Returns the configuration object the SAML SDK retrieved from the wicked API (e.g., the `auth-saml.json` settings from the `auth-servers` configuration of your API portal).
