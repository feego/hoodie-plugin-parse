/**
 *
 * Parse integration plugin for Hoodie
 */
var Parse = require('parse').Parse,
    https = require('https'),
    md5 = require('MD5'),
    socketIO = require('socket.io-client'),
    pluginMetadataDatabase = null

// Plugin constant values
// TODO create config page to set this values

var PARSE_APPLICATION_ID, PARSE_JAVASCRIPT_KEY, PARSE_REST_KEY, SOCKET_IO_SERVER_URL, collectionsToSyncOnInit,
    PARSE_BASE_URL = 'api.parse.com',
    PARSE_API_VERSION = 1,
    publicLastSynchedAt = null,
    privateLastSynchedAt = null

// Plugin auxiliary methods
function createDatabase(hoodie, databaseName, readPermission) {
    return new Promise(function (resolve, reject) {
        // readPermission must follow the pattern 'user/userid123'
        if (readPermission) {
            if ((typeof readPermission == 'string') && /^user\/[a-z0-9]*$/.test(readPermission)) {
                databaseName = readPermission + "/" + databaseName.toLowerCase()
            } else {
                reject(new Error('Invalid permission value.'))
            }
        }
        // Create database
        hoodie.database.add(databaseName, function (error, database) {
            if (error) {
                console.log(error)
                return reject(error)
            }
            if (!readPermission) {
                var grantMethod = database.grantPublicReadAccess
                if (grantMethod) {
                    grantMethod.call(database, function (error) {
                        if (error) {
                            reject(error)
                            return;
                        } else {
                            resolve(database)
                        }
                    });
                }
            } else {
                var couchSecurityUrl = database._resolve('_security')
                var securityValues = {
                    admins : {
                        names : [],
                        roles : []
                    },
                    members : {
                        names : [],
                        roles : [
                            'hoodie:read:' + readPermission,
                            'hoodie:write:' + readPermission
                        ]
                    }
                }
                hoodie.request('PUT', couchSecurityUrl, {data: securityValues}, function(error, body, response) {
                    if (error) {
                        return reject(error)
                    }
                    resolve(database)
                });
            }
        })
    })
}
function addToDatabase(hoodieDatabase, hoodieCollectionName, object) {
    return new Promise(function(resolve, reject) {
        hoodieDatabase.add(hoodieCollectionName, object, function (error) {
            if (error && error.error) {
                reject({reason: error.reason, objectId: object.id})
            }
            resolve()
        })
    })
}
function findInDatabase(hoodieDatabase, hoodieCollectionName, object) {
    return new Promise(function(resolve, reject) {
        hoodieDatabase.find(hoodieCollectionName, object.id, function (error, result) {
            if (error && error.error) {
                reject({reason: error.reason, objectId: object.id})
            }
            resolve(result)
        })
    })
}
function updateToDatabase(hoodieDatabase, hoodieCollectionName, object) {
    return new Promise(function(resolve, reject) {
        hoodieDatabase.update(hoodieCollectionName, object.id, object, function (error, result) {
            // Ignoring error, because the hoodie plugins API update method returns conflict errors
            // when updating successfully an already existent document
            //if (error && error.error) {
            //    reject({reason: error.reason, objectId: object.id})
            //    console.log("error on update:", error.error, object)
            //}
            resolve(result)
        })
    })
}
function getDatabaseLastSynchedTimestamp(collectionType, collectionName) {
    var lastSynchedAt = null,
        now = (new Date()).toISOString()
    return findInDatabase(pluginMetadataDatabase, collectionType, {id: collectionName})
        .then(function(result) {
            lastSynchedAt = result.lastSynchedAt
            return updateToDatabase(pluginMetadataDatabase, collectionType, {
                _rev: result._rev,
                id: collectionName,
                lastSynchedAt: now
            })
        })
        .catch(function() {
            lastSynchedAt = null
            return addToDatabase(pluginMetadataDatabase, collectionType, {
                id: collectionName,
                lastSynchedAt: now
            })
        })
        .then(function() {
            return lastSynchedAt
        })
}
function syncToHoodie(hoodieDatabase, hoodieCollectionName, object) {
    // Add parse namespaces to prevent conflicts with CouchDB fields
    object.parseCreatedAt = object.createdAt
    object.parseUpdatedAt = object.updatedAt
    delete object.createdAt
    delete object.updatedAt

    return addToDatabase(hoodieDatabase, hoodieCollectionName, object)
        .catch(function() {
            return findInDatabase(hoodieDatabase, hoodieCollectionName, object)
        })
        .then(function(result) {
            object._rev = result._rev
            // Checks updatedAt timestamp from both Hoodie and Parse and updates the Hoodie version
            // of the object if it doesn't match
            if (result.updatedAt != object.parseUpdatedAt) {
                console.log("UPDATED Parse object:", hoodieCollectionName, object.objectId)
                return addToDatabase(hoodieDatabase, hoodieCollectionName, object)
            }
        })
}
function queryCollection(hoodie, parseCollectionName, hoodieDatabase) {
    var Collection = Parse.Object.extend(parseCollectionName),
        query = new Parse.Query(Collection),
        collectionName = parseCollectionName.toLowerCase()
    // Update only elements changed since last synchronization
    getDatabaseLastSynchedTimestamp('parse-collection', collectionName)
        .then(function(lastSynchedAt) {
            if (lastSynchedAt) {
                query.greaterThanOrEqualTo('updatedAt', lastSynchedAt)
            }
            return query.find()
        })
        .then(function(response) {
            for (var i = 0; i < response.length; i++) {
                var object = response[i].toJSON()
                object.id = md5(response[i].id)
                syncToHoodie(hoodieDatabase, 'parse--' + collectionName, object)
            }
        })
}
function queryParseCollections(hoodie, hoodieDatabase, collectionsToSync) {
    var collectionList = (collectionsToSync) ? collectionsToSync : collectionsToSyncOnInit
    for (var index = 0; index < collectionList.length; index++) {
        var collectionName = collectionList[index]
        queryCollection(hoodie, collectionName, hoodieDatabase)
    }
}
function syncPublicCollections(hoodie, collectionsToSync) {
    createDatabase(hoodie, 'parse_public')
        .then(function (hoodieDatabase) {
            queryParseCollections(hoodie, hoodieDatabase, collectionsToSync)
        })
        .catch(function (error) {
            console.error("Error: " + error.code + " " + error.message)
        })
}
// Synchronize private data methods
function restAPIRequest(path, headers, lastSyncTimestamp) {
    return new Promise(function (resolve, reject) {
        var queryParams = (lastSyncTimestamp) ? ('?where=' + encodeURIComponent('{"updatedAt":{"$gt":{"__type":' +
                '"Date", "iso":"' + lastSyncTimestamp + '"}}}')) : '',
            options = {
                host: PARSE_BASE_URL,
                path: path + queryParams,
                method: 'GET',
                headers: headers
            }

        // Perform HTTP request
        var request = https.request(options, function (response) {
            var receivedData = ''

            response.setEncoding('utf8')
            response.on('data', function (chunk) {
                receivedData += chunk
            })
            response.on('end', function() {
                var parsedJSON = JSON.parse(receivedData)
                if (parsedJSON.code || parsedJSON.error) {
                    reject("Invalid json:" + receivedData)
                }
                resolve(parsedJSON)
            })
            response.on('close', function(error) {
                reject(error)
            })
        })
            .on('error', function (error) {
                reject(error)
            })
            .end()
    })
}
function mapParseHoodieUser(hoodie, hoodieUserId, parseUserId) {
    findInDatabase(pluginMetadataDatabase, 'parse-hoodie-id-map', {id: parseUserId})
        .catch(function(result) {
            addToDatabase(pluginMetadataDatabase, 'parse-hoodie-id-map', {
                id: parseUserId,
                hoodieId: hoodieUserId
            })
        })
}
function sessionUserQuery(hoodie, hoodieUserId, parseSessionToken) {
    var path = '/' + PARSE_API_VERSION + '/users/me',
        headers = {
            'X-Parse-Application-Id': PARSE_APPLICATION_ID,
            'X-Parse-REST-API-Key': PARSE_REST_KEY,
            'X-Parse-Session-Token': parseSessionToken
        },
        metadataObjectId = hoodieUserId + '/parse-user'
    // Updated only the elements changed since the last synchronization
    getDatabaseLastSynchedTimestamp('parse-collection', metadataObjectId)
        .then(function(lastSynchedAt) {
            return restAPIRequest(path, headers, lastSynchedAt)
        })
        .then(function (response) {
            response.id = md5(response.objectId)
            mapParseHoodieUser(hoodie, hoodieUserId, response.id)

            hoodieDatabase = hoodie.database(hoodieUserId)
            syncToHoodie(hoodieDatabase, 'parse--parse-user', response)
            privateLastSynchedAt = (new Date()).toISOString()
        })
        .catch(function (error) {
            console.log("Error querying Parse collection User", "Error:", error)
        })
}
function sessionQueryCollection(collectionName, hoodieDatabase, parseSessionToken, hoodieUserId) {
    var path = '/' + PARSE_API_VERSION + ((collectionName == 'User') ? '/users' : ('/classes/' + collectionName)),
        headers = {
            'X-Parse-Application-Id': PARSE_APPLICATION_ID,
            'X-Parse-REST-API-Key': PARSE_REST_KEY,
            'X-Parse-Session-Token': parseSessionToken
        },
        metadataObjectId = hoodieUserId + '/' + collectionName.toLowerCase()

    // Updated only the elements changed since the last synchronization
    getDatabaseLastSynchedTimestamp('parse-collection', metadataObjectId)
        .then(function(lastSynchedAt) {
            return restAPIRequest(path, headers, lastSynchedAt)
        })
        .then(function(response) {
            for (var i = 0; i < response.results.length; i++) {
                response.results[i].id = md5(response.results[i].objectId)
                syncToHoodie(hoodieDatabase, 'parse--' + collectionName.toLowerCase(), response.results[i])
            }
            privateLastSynchedAt = (new Date()).toISOString()
        })
        .catch(function (error) {
            console.log("Error querying Parse collection", collectionName, "Error:", error)
        })
}
function sessionQueryParseCollections(hoodieDatabase, hoodieUserId, collectionList, parseSessionToken) {
    for (var index = 0; index < collectionList.length; index++) {
        if ((typeof collectionList[index]) == 'string') {
            var collectionName = collectionList[index]
            sessionQueryCollection(collectionName, hoodieDatabase, parseSessionToken, hoodieUserId)
        }
    }
}
function syncPrivateData(hoodie, hoodieUserId, parseSessionToken, collectionList) {
    if (collectionList) {
        var hoodieDatabase = hoodie.database(hoodieUserId)
        sessionQueryParseCollections(hoodieDatabase, hoodieUserId, collectionList, parseSessionToken)
    } else {
        // Fetch only the logged user info
        sessionUserQuery(hoodie, hoodieUserId, parseSessionToken)
    }
}
function subscribeParseChangeEvents(hoodie) {
    var socket = socketIO(SOCKET_IO_SERVER_URL)
    socket.on('collectionUpdated', function(message) {
        if (!message.permissions) {
            syncPublicCollections(hoodie, [message.collection])
        } else {
            for (var index = 0; index < message.permissions.length; index++) {
                var parseIdMD5 = md5(message.permissions[index]),
                    userHoodieId = null,
                    userDatabase = null
                findInDatabase(pluginMetadataDatabase, 'parse-hoodie-id-map', {id: parseIdMD5})
                    .then(function(result) {
                        userHoodieId = result.hoodieId
                        userDatabase = hoodie.database(userHoodieId)
                        return findInDatabase(userDatabase, 'parse--parse-user', {id: parseIdMD5})
                    })
                    .then(function(result) {
                        return syncPrivateData(hoodie, userHoodieId, result.sessionToken, [message.collection])
                    })
            }
        }
    })
}

// Plugin declaration
module.exports = function (hoodie, doneCallback) {
    // Plugin initialization tasks
    PARSE_APPLICATION_ID = hoodie.config.get("parsePlugin__parseAPIKey")
    PARSE_JAVASCRIPT_KEY = hoodie.config.get("parsePlugin__parseJSKey")
    PARSE_REST_KEY = hoodie.config.get("parsePlugin__parseRESTKey")
    SOCKET_IO_SERVER_URL = hoodie.config.get("parsePlugin__socketIOUrl")
    collectionsToSyncOnInit = hoodie.config.get("parsePlugin__collectionsToSyncOnInit")

    Parse.initialize(PARSE_APPLICATION_ID, PARSE_JAVASCRIPT_KEY)
    createDatabase(hoodie, 'parse_plugin_metadata')
        .then(function() {
            pluginMetadataDatabase = hoodie.database('parse_plugin_metadata')
            syncPublicCollections(hoodie)
            subscribeParseChangeEvents(hoodie)
        })

    hoodie.task.on('parse-plugin-initialize:add', function(database, taskData) {
        taskData.PARSE_APPLICATION_ID = PARSE_APPLICATION_ID
        taskData.PARSE_JAVASCRIPT_KEY = PARSE_JAVASCRIPT_KEY
        return hoodie.task.success(database, taskData)
    })

    hoodie.task.on('parse-sync-public-collections:add', function (database, taskData) {
        // Set up CouchDb replication from public parse database to user's database
        hoodie.request('POST', '/_replicate', {
            data: {
                source: 'parse_public',
                target: database,
                continuous: true
            }
        }, function(error, body, response) { /*Success*/ })
        // Sync public collections
        if (taskData.collectionsToSync && !(taskData.collectionsToSync instanceof Array)) {
            var errorMessage = "The sync-public-collections task must receive an array with the " +
                "collection's names to sync."
            return hoodie.task.error(database, taskData, new Error(errorMessage))
        }
        syncPublicCollections(hoodie, taskData.collectionsToSync)
        return hoodie.task.success(database, taskData)
    })

    hoodie.task.on('parse-sync-private-data:add', function (database, taskData) {
        if (taskData.collectionsToSync && !(taskData.collectionsToSync instanceof Array)) {
            var errorMessage = "The sync-private-data task must receive an array with the collection's " +
                "names to sync."
            return hoodie.task.error(database, taskData, new Error(errorMessage))
        } else if (!taskData.parseSessionToken) {
            var errorMessage = "The sync-private-data task must receive valid Parse session token."
            return hoodie.task.error(database, taskData, new Error(errorMessage))
        }
        syncPrivateData(hoodie, database, taskData.parseSessionToken, taskData.collectionsToSync)
        return hoodie.task.success(database, taskData)
    })

    doneCallback();
};
