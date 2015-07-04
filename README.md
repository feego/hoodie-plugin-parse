# Parse Hoodie Plugin
> Parse data sync plugin for Hoodie.

#### Installation

```bash
hoodie install parse
```

After installing the plugin, you must configure it using your Parse App configuration keys. You need to do this both for the plugin's front-end and backend code. To setup the keys for the plugin's backend, you can use the plugin's admin dashboard. However, the plugin's front-end configuration have to be done directly in the plugin's front-end API code, in the line 8 of the file "hoodie.parse.js":

```js
// Parse App settings
var PARSE_APPLICATION_ID = 'PARSE_APPLICATION_ID'
var PARSE_JAVASCRIPT_KEY = 'PARSE_JAVASCRIPT_KEY'
```

To enable the real-time data sync between the data stored on Hoodie and on Parse, the plugin subscribes a SocketIO channel which will receive a message each time a data collection is changed on Parse. To use this feature, you must use the Parse's Cloud Code "afterSave" events to notify a SocketIO server that will later publish the corresponding notifications on the SocketIO channel this plugin is subscribing. The messages received on the plugin must respect the following pattern:

```js
{
    collection: 'collectionName',
    permissions: ['parseUserId1', 'parseUserId2', 'parseUserIdN']
}
```

#### Front-end API

```js
// TODO: sign in 
// hoodie.parse.authenticate(username, password)
// sign in with Facebook
hoodie.parse.authenticateWithFacebook()
// sync public data from Parse
hoodie.parse.syncPublicCollections(collectionNamesArray)
// sync private data from Parse
hoodie.parse.syncPrivateData(collectionNamesArray)
// sign out
hoodie.parse.deauthenticate()
// access parse front-end API instance
hoodie.parse.Parse
```

#### License

The MIT License (MIT)

Copyright (c) 2015 GlazedSolutions