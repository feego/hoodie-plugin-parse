/* Hoodie plugin front-end API */
var Parse = require('parse').Parse,
    md5 = require('MD5')

Hoodie.extend(function (hoodie, lib, utils) {
    'use strict';

    // Parse App settings
    var PARSE_APPLICATION_ID = 'PARSE_APPLICATION_ID'
    var PARSE_JAVASCRIPT_KEY = 'PARSE_JAVASCRIPT_KEY'

    function generateSimpleHash(string) {
        var hash = 0, char = null
        if (string.length == 0) return hash;
        for (i = 0; i < string.length; i++) {
            char = string.charCodeAt(i);
            hash = ((hash<<5)-hash)+char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash;
    }

    function getParseSessionToken() {
        if (isUserLogged()) {
            return Parse.User.current().getSessionToken()
        } else {
            throw new Error('No current Parse session.')
        }
    }

    function syncPublicCollections(collectionsToSync) {
        if (collectionsToSync && !(collectionsToSync instanceof Array)) {
            return console.error('Method "syncPublicData" must receive an array with the collection\'s ' +
                'names to sync.')
        }
        var taskData = {}
        if (collectionsToSync) {
            taskData.collectionsToSync = collectionsToSync
        }
        return hoodie.task.start('parse-sync-public-collections', taskData)
    }

    function syncPrivateData(collectionsToSync) {
        if (collectionsToSync && !(collectionsToSync instanceof Array)) {
            return console.error('Method "syncPrivateData" must receive an array with the collection\'s ' +
                'names to sync.')
        }
        var taskData = {parseSessionToken: getParseSessionToken()}
        if (collectionsToSync) {
            taskData.collectionsToSync = collectionsToSync
        }
        return isUserLogged() && hoodie.task.start('parse-sync-private-data', taskData)
    }

    function isUserLogged() {
        return (Parse.User && Parse.User.current() && hoodie.account.username)
    }

    function parseAuthentication(email, password) {
        // Only procceed if there's no opened session
        if (isUserLogged()) {
            return console.log("There's already an opened Parse session.")
        }
        // Parse standalone authentication
        if (!email || !password) {
            throw new Error('Invalid Parse credentials!')
        } else {
            // authentication
            // TODO
            //initializeParsePrivateStore()
            // Replicate public Parse database to user's private database
            syncPublicCollections()
            syncPrivateData()
        }
    }

    function loginWithFacebook() {
        // Parse authentication with Facebook
        return Parse.User._logInWith('facebook', {
            authData: {
                id: FB.getUserID(),
                access_token: FB.getAccessToken(),
                expiration_date: new Date(FB.getAuthResponse().expiresIn * 1000 + (new Date()).getTime()).toJSON()
            }
        }).then(function () {
            //initializeParsePrivateStore()
            // Replicate public Parse database to user's private database
            syncPublicCollections()
            syncPrivateData()
        })

    }

    function parseFacebookAuthentication() {
        // Only procceed if there's no opened session
        if (isUserLogged()) {
            return console.log("There's already an opened Parse session.")
        }
        if (!FB.getAccessToken()) {
            return hoodie.facebookSession.logIn()
                .then(loginWithFacebook)
                .catch(function(error) {
                    console.error(error)
                })
        } else {
            return loginWithFacebook()
        }
    }

    function parseDeauthentication() {
        hoodie.facebookSession.logOut()
            .then(function () {
                Parse.User.logOut()
            })
            .catch(function (error) {
                console.error(error)
            })
    }

    function generateStoreApiMethods(prefix) {
        if (prefix != 'parse--') {
            throw new Error('Invalid collection prefix.')
        }
        return {
            findAllFromCollection: function(collectionName, queryFunction) {
                if (typeof collectionName != 'string') {
                    throw new Error('You must call this method with a collection\'s name')
                }
                return hoodie.store.findAll(function(object) {
                        return object.type === prefix + collectionName.toLowerCase()
                            && (!queryFunction || queryFunction(object))
                    })
            },
            findFromCollectionByParseId: function(collectionName, objectId) {
                if (typeof collectionName != 'string') {
                    throw new Error('You must call this method with a collection\'s name')
                } else if (typeof collectionName != 'string') {
                    throw new Error('You must call this method with an object id')
                }
                return hoodie.store.find(prefix + collectionName.toLowerCase(), md5(objectId))
            },
            onAdd: function(collectionName, callback) {
                hoodie.store.on(prefix + collectionName.toLowerCase() + ':add', callback)
                // BUG HOODIE: add event sometimes activated as an update event
                hoodie.store.on(prefix + collectionName.toLowerCase() + ':update', function(result) {
                    if (result.createdAt == result.updatedAt || !result.updatedAt)
                        callback(result)
                })
            },
            onItemUpdated: function(collection, id, callback) {
                hoodie.store.on(prefix + collection.toLowerCase() + ':' + id + ':update', callback)
            },
            onUpdate: function(collection, callback) {
                hoodie.store.on(prefix + collection.toLowerCase() + ':update', callback)
            },
            onItemRemoved: function(collection, id, callback) {
                hoodie.store.on(prefix + collection.toLowerCase() + ':' + id + ':remove', callback)
            },
            onRemove: function(collection, callback) {
                hoodie.store.on(prefix + collection.toLowerCase() + ':remove', callback)
            }
        }
    }

    function initializeParseStore() {
        // Replicate public Parse database to user's private database
        syncPublicCollections()
        // Initialize store api for public collection
        hoodie.parse.store = generateStoreApiMethods('parse--')
    }

    // Extends Hoodie API
    hoodie.parse = {
        authenticate: parseAuthentication,
        authenticateWithFacebook: parseFacebookAuthentication,
        syncPublicCollections: syncPublicCollections,
        syncPrivateData: syncPrivateData,
        deauthenticate: parseDeauthentication,
        Parse: Parse
    }

    // Initialization
    Parse.initialize(PARSE_APPLICATION_ID, PARSE_JAVASCRIPT_KEY)
    initializeParseStore()
    if (isUserLogged()) {
        //initializeParsePrivateStore()
        syncPrivateData()
    }
})