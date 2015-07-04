# Hoodie Facebook Login Plugin

> Use Facebook credentials to login into your hoodie app.

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