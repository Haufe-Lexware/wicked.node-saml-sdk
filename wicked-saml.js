'use strict';

var debug = require('debug')('wicked-sdk:saml');
var saml2 = require('saml2-js');

// Package storage
const samlStorage = {
    config: {
        initialized: false,
        spOptions: {},
        idpOptions: {}
    },
    serviceProvider: null,
    identityProvider: null,
    wicked: null
};

// ======= INTERFACE DEFINITION =======

exports.initialize = function (wicked, serverId, callback) {
    initialize(wicked, serverId, callback);
};

exports.metadata = function () {
    return metadata;
};

exports.login = function (callback) {
    return login(callback);
};

exports.assert = function (req, requestId, callback) {
    return assert(req, requestId, callback);
};

exports.redirectAssert = function (req, callback) {
    return redirectAssert(req, callback);
};

exports.getAttributeNames = function (samlResponse) {
    return getAttributeNames(samlResponse);
};

exports.getAttributeValue = function (samlResponse, wantedAttribute) {
    return getAttributeValue(samlResponse, wantedAttribute);
};

exports.getConfig = function () {
    return getConfig();
};

// ======= IMPLEMENTATION =======

function initialize(wicked, serverId, callback) {
    debug('initialize()');
    samlStorage.wicked = wicked;
    wicked.apiGet('auth-servers/' + serverId, function (err, serverInfo) {
        if (err) {
            debug('Getting auth-server settings for ' + serverId + ' failed.');
            debug(err);
            return callback(err);
        }

        if (!serverInfo.saml)
            return callback(new Error('The auth-server configuration does not contain a "saml" property.'));
        if (!serverInfo.saml.spOptions)
            return callback(new Error('The auth-server saml configuration does not contain an "spOptions" property.'));
        if (!serverInfo.saml.idpOptions)
            return callback(new Error('The auth-server saml configuration does not contain an "idpOptions" property.'));

        samlStorage.config.spOptions = serverInfo.saml.spOptions;
        samlStorage.config.idpOptions = serverInfo.saml.idpOptions;
        if (serverInfo.saml.profile)
            samlStorage.config.profile = serverInfo.saml.profile;
        samlStorage.config.initialized = true;

        debug('Read auth-server configuration.');
        debug(samlStorage.config);

        debug('Creating SAML SP and IdP');
        samlStorage.serviceProvider = new saml2.ServiceProvider(samlStorage.config.spOptions);
        samlStorage.identityProvider = new saml2.IdentityProvider(samlStorage.config.idpOptions);

        callback(null);
    });
}

function getConfig() {
    debug('getConfig()');
    return samlStorage.config;
}

function metadata(req, res, next) {
    res.type('application/xml');
    res.send(samlStorage.serviceProvider.create_metadata());
}

function login(callback) {
    debug('login');
    samlStorage.serviceProvider.create_login_request_url(samlStorage.identityProvider, {}, function (err, loginUrl, requestId) {
        if (err) {
            console.error('create_login_request_url failed.');
            console.error(err);
            return callback(err);
        }
        return callback(null, {
            loginUrl: loginUrl,
            requestId: requestId
        });
    });
}

function assert(req, requestId, callback) {
    debug('assert');
    if (!requestId || typeof (requestId) !== 'string')
        return callback(new Error('wickedSaml.assert needs a requestId to verify the SAML assertion.'));

    const options = { request_body: req.body };
    samlStorage.serviceProvider.post_assert(samlStorage.identityProvider, options, function (err, samlResponse) {
        if (err) {
            debug('post_assert failed.');
            debug(err);
            return callback(err);
        }

        if (!samlResponse.response_header)
            return callback(new Error('The SAML response does not have a response_header property'));
        if (!samlResponse.response_header.in_response_to)
            return callback(new Error('The SAML response\'s response_header does not have an in_response_to property.'));
        if (samlResponse.response_header.in_response_to != requestId) {
            debug('wrong request ID in SAML response, in_response_to: ' + samlResponse.response_header.in_response_to + ', requestId: ' + requestId);
            return callback(new Error('The SAML assertion does not correspond to expected request ID. Please try again.'));
        }

        debug('samlResponse:');
        debug(JSON.stringify(samlResponse, null, 2));
        const userInfo = {
            authenticated_userid: findSomeId(samlResponse)
        };
        callback(null, userInfo, samlResponse);
    });
}

function redirectAssert(req, callback) {
    debug('redirect_assert');
    if (!req.query || !req.query.SAMLRequest )
        return callback(new Error('Request does not contain a SAMLRequest query parameter. Cannot parse.'));
    const options = { request_body: req.query };
    samlStorage.serviceProvider.redirect_assert(samlStorage.identityProvider, options, function (err, samlRequest) {
        if (err) {
            debug('redirect_assert failed.');
            debug(err);
            return callback(err);
        }

        if (!samlRequest.response_header)
            return callback(new Error('The SAML Request does not have a response_header property'));
        if (!samlRequest.response_header.id)
            return callback(new Error('The SAML Request\'s response_header does not have an id property.'));

        debug('samlResponse:');
        debug(JSON.stringify(samlRequest, null, 2));

        callback(null, samlRequest);
    });
}

function getAttributeNames(samlResponse) {
    const attributeNames = [];
    if (samlResponse.user && samlResponse.user.attributes) {
        for (let attributeName in samlResponse.user.attributes) {
            attributeNames.push(attributeName.toLowerCase());
        }
    }
    return attributeNames;
}

function getAttributeValue(samlResponse, wantedAttribute) {
    let returnValue = null;
    if (samlResponse.user && samlResponse.user.attributes) {
        for (let attributeName in samlResponse.user.attributes) {
            if (attributeName.toLowerCase() == wantedAttribute.toLowerCase()) {
                const attributeValues = samlResponse.user.attributes[attributeName];
                if (Array.isArray(attributeValues) && attributeValues.length > 0) {
                    returnValue = attributeValues[0];
                    break;
                } else if (isString(attributeValues)) {
                    returnValue = attributeValues;
                    break;
                } else {
                    debug('Found attribute ' + wantedAttribute + ', but it\'s neither an array nor a string.');
                }
            }
        }
    }
    return returnValue;
}

function findEmail(samlResponse) {
    return getAttributeValue(samlResponse, 'email');
}

function findSomeId(samlResponse) {
    const attributeNames = getAttributeNames(samlResponse);
    for (let i = 0; i < attributeNames.length; ++i) {
        const attrName = attributeNames[i];
        if (attrName.endsWith('id')) {
            debug('findSomeId: Guessing we want attribute ' + attrName + ' as custom_id.');
            return getAttributeValue(samlResponse, attrName);
        }
    }
    console.error('wicked-saml: findSomeId() could not find a suitable ID for custom_id.');
    return null;
}

function isString(ob) {
    return (ob instanceof String || typeof ob === "string");
}
