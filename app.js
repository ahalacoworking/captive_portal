var express = require('express');
var bodyParser = require('body-parser');
var multer = require('multer');
var request = require('request');
var https = require('https');
require('log-timestamp');

// config --------------------------------------------------

var CONFIG = require('./config').CONFIG;
var cobot_api = "https://www.cobot.me/api/";
var cobot_space_api = "https://betatest.cobot.me/api/";

// express setup -------------------------------------------

GLOBAL.app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(multer({ dest: __dirname + '/uploads' }));
app.use("/uploads", express.static(__dirname + '/uploads'));
app.use("/static", express.static(__dirname + '/static'));

var swig  = require('swig');
swig.setDefaults({ cache: false });

app.engine('html', swig.renderFile);

app.set('view engine', 'html');
app.set('views', __dirname + '/views');

// oauth2 client -------------------------------------------

var oauth2 = require('simple-oauth2')({
  clientID: CONFIG.client_id,
  clientSecret: CONFIG.client_secret,
  site: 'https://www.cobot.me',
  tokenPath: '/oauth/access_token'
});

var grants = {};

// routes

app.get('/', function(req, res) {
  console.log(req.query);

  var grant_url = req.query.base_grant_url;

  if (grant_url) {
    var grant_id = parseInt(Math.random()*100000000000);
    
    var continue_url = CONFIG.base_uri+"/enjoy?g="+grant_id;
    if (req.query.user_continue_url) {
      continue_url = req.query.user_continue_url;
    }
    
    grants[grant_id] = {g: grant_url, c: continue_url};

    res.redirect("/hello/"+grant_id);

    return;
  }

  res.send("missing parameter.");
});

app.get('/hello/:grant_id', function(req,res) {
  var grant_id = req.params.grant_id;
  
  /*var authorization_uri_member = oauth2.authCode.authorizeURL({
    redirect_uri: CONFIG.base_uri+"/callback_member?grant="+grant_id,
    scope: 'read_user'
  });

  console.log("authorization_uri_member: ",authorization_uri_member);*/

  res.render("hello", {status: req.query.status, grant_id: grant_id});
});

app.post('/login', function(req,res) {

  var options = {
    uri: cobot_space_api+"check_ins?access_token="+CONFIG.admin_token,
    method: "POST",
    json: {
      "login": req.body.email,
      "password": req.body.password
    }
  };

  console.log("trying to log in: "+req.body.email);

  var grant_id = parseInt(req.body.grant_id);
  var grant = grants[grant_id];

  if (!grant) {
    console.log("invalid grant.");
    res.redirect("/");
    return;
  }
  
  request(options, function(err, cres) {
    var status = cres.statusCode;
    console.log("check-in result ("+status+") for "+req.body.email+": ", cres.body);

    if (status >= 200 && status < 400) {
      res.render("enjoy", {user_name:req.body.email, grant_uri:grant.g+"?continue_url="+encodeURIComponent(grant.c)});
    } else {
      if (cres.body && cres.body.errors) {
        status = cres.body.errors;
        if (status.base) {
          status = status.base.join(" ");
        } else {
          status = JSON.stringify(cres.body.errors);
        }
      }
      res.redirect("/hello/"+grant_id+"?status="+status);
    }
  });
});

app.get('/enjoy', function(req,res) {
  var grant_id = req.query.g;
  var grant = grants[grant_id];
  if (!grant) {
    res.send("error: unknown grant.");
    return;
  }
  var oauth_token = null; //grant.oauth_token;
  var user_name = "Betahaus Member";

  if (oauth_token) {
    // resolve user details
    request.get(cobot_space_api+"user?access_token="+oauth_token, function(err, user_res) {
      console.log("user req result: ",user_res.body);
      var user = JSON.parse(user_res.body);
      
      res.render("enjoy", {user_name:user.name||user.email});
    });
  } else {
    res.render("enjoy", {user_name:user_name, grant_uri:grant.g+"?continue_url="+encodeURIComponent(grant.c)});
  }
});

app.get('/help', function(req,res) {
  res.render("help", {});
});

app.get('/admin_auth', function(req,res) {
  var authorization_uri_admin = oauth2.authCode.authorizeURL({
    redirect_uri: CONFIG.base_uri+"/callback_admin",
    scope: 'read_user,checkin'
  });
  
  res.redirect(authorization_uri_admin);
});

app.get('/callback_admin', function(req,res) {
  var code = req.query.code;

  oauth2.authCode.getToken({
    code: code
  }, function(error, result) {
    if (error) {
      console.log('Access Token Error', error.message);
    } else {
      var token = oauth2.accessToken.create(result).token;
      res.send(token);
    }
  });
});

app.get('/callback_member', function(req,res) {
  var code = req.query.code;
  
  if (req.query.grant) {
    var grant_id = req.query.grant;
    var grant = grants[grant_id];
    if (grant) {
      // break out
      /*oauth2.authCode.getToken({
        code: code
      }, function(error, result) {
        if (error) {
          console.log('Access Token Error', error.message);
        } else {
          var token = oauth2.accessToken.create(result).token;
          grant.oauth_token = token.access_token;
          res.render("breakout",{grant_uri:grant.g+"?g="+grant_id});
        }
      });*/
      res.render("breakout",{grant_uri:grant.g+"?continue_url="+encodeURIComponent(grant.c)});
    } else {
      res.send("error: unknown grant.");
    }
  } else {
    res.send("error: missing grant id");
  }
});

// launch --------------------------------------------------

var port = 9998;
var args = process.argv;

if (args[2]) {
  port = parseInt(args[2]);
}

var server = app.listen(port, function() {
  console.log('betahaus_captive listening on port %d', server.address().port);
});

if (CONFIG.ssl) {
  var options = {
    key: fs.readFileSync('key.pem'),
    cert: fs.readFileSync('cert.cert')
  };

  var https_server = https.createServer(options, app).listen(443, function() {
    console.log('betahaus_captive https listening on port 443');
  });
}

