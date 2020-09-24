// BUG: entering blank into user ID causes crash

const { resolve, all } = require("bluebird");
const { lib } = require("nunjucks");
const { pathMatch } = require("tough-cookie");

var express = require("express"),
    mongoose = require("mongoose"),
    session = require("express-session"),
    passport = require("passport"),
    SpotifyStrategy = require("passport-spotify").Strategy,
    expressSanitizer = require("express-sanitizer"),
    override = require("method-override"),
    bodyParser = require("body-parser"),
    Promise = require('bluebird'),
    request = require('request-promise-native'),
    SpotifyAPI = require('spotify-web-api-node'),
    User = require("./models/User.js");

    require("dotenv").config();

const port = process.env.PORT || 8888;
const authCallbackPath = "/callback";
const connectionString = process.env.connectionString;

// Express set up
var app = express();

app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(bodyParser.urlencoded({extended: true}));
app.use(expressSanitizer());
app.use(override("_method"));
app.use(session({ secret: "ninjawarrior", resave: true, saveUninitialized: true }));
app.use(passport.initialize());
app.use(passport.session());

// MongoDB
mongoose.connect(connectionString, {useUnifiedTopology: true, useNewUrlParser: true});

// Spotify API
var spotifyApi = new SpotifyAPI();

// Passport
passport.serializeUser(function (user, done) {
  done(null, user);
});

passport.deserializeUser(function (obj, done) {
  done(null, obj);
});

/**
 * Create a playlist on Spotify for a user
 * @param  {Array} songIDs Array of SongIDs (formatted) to add to playlist
 * @param {req.user} user1 User object who will be the owner
 * @param {String} user2_name Name of the second user for title of playlist
 * @return Nothing
 */
function _createPlaylist(songIDs, user1, user2_name){

  // Check if the list of song IDs is empty
  if(!songIDs[0]){
    console.log("You don't have any songs in common!");
  } else {
    spotifyApi.createPlaylist(user1.username, 'Spotify Match: ' + user2_name + ' & ' + user1.name, { 'public' : false })
    .then(function(data) {

      // Add playlist ID to user's storage to display later
      User.findOne({username: user1.username}, function(err, user){
        user.spotify_match_playlists.push(data.body.uri);
        user.save(function(err){ if(err) { console.log(err) } });
      });

      // Populate the new playlist with songs in common
      spotifyApi.addTracksToPlaylist(data.body.id, songIDs)
      .then(function(data) {

        // TO DO: do something here lol
        console.log('Successfully added songs!');
      }, function(err) {
        console.log('Something went wrong (adding tracks)!', err);
      });
    }, function(err) {
      console.log('Something went wrong (creating playlist)!', err);
    });
  }
}

/**
 * Returns a page of the user library
 * @param  {string} accessToken Spotify API's access token
 * @param {number} offset Specify the number of songs to skip when reading
 * @param {number} limit Specify how many songs to return
 * @return {Promise} A promise which contains the specified portion of the user library
 */
async function _getDataOfPage(accessToken, offset, limit){
  return new Promise(resolve => {
    const userLibrary = request({
      method: 'GET',
      uri: `https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`,
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      json: true
      });
    resolve(userLibrary);
  });
}


// TO DO: ADD UNIQuE USER VALIDATION
/**
 * Validate a user's ID
 * @param  {String} id User ID to validate
 * @return {Boolean} Return if the id is valid or not
 */
function _validateID(id){
  if(/^[a-z0-9]+$/i.test(id) && id.length > 3){
    return true;
  } else {
    console.log("ID must be alphanumeric and longer than 3 characters!");
    return false;
  }
}

// Use Passport.JS Spotify strategy to authenticate user into the app
passport.use(
  new SpotifyStrategy(
    {
      clientID: process.env.clientID,
      clientSecret: process.env.clientSecret,
      callbackURL: "http://spotify-match-app.herokuapp.com" + authCallbackPath,
    },

    // Authenticate a user and pull their music library into database
    async function (accessToken, refreshToken, expires_in, profile, done) {

      // Set Spotify API wrapper's access token
      spotifyApi.setAccessToken(accessToken);

      // Get user's library length using a Spotify API call
      var libraryLength;
      _getDataOfPage(accessToken, 0, 1)

      // Retrieving library length asynchronously
      .then(
        function(data){
          libraryLength = data.total;
        },
        function(err){
          console.log(err);
        }
      )

      // Retrieving library items asynchronously
      .then(
        function(data){
          // Array of promises resolving to the user's entire song library
          var promises = [];

          // Loop to get the entire user's library
          // NOTE: Spotify's API limits the number of songs returned to 50
          // so this has to be done to circumvent that
          for(let i = 0; i < libraryLength/50; i++){
            promises.push(new Promise((resolve) => {
              let songs = _getDataOfPage(accessToken, i * 50, 50);
              resolve(songs);
            }));
          }

          // Construct user's entire song library from resolved Promises
          // and extract song IDs to store
          Promise.map(promises, Promise.props)
          .then(results => {
            var userLibraryOfSongIDs = [];
            results.forEach(function(result){
              result.items.forEach(function(trackWrapper){
                userLibraryOfSongIDs.push(trackWrapper.track.id);
              });
            })

            // Find or create a user using all of the specified data
            User.findOrCreate({ username: profile.id }, function(err, user) {
              user.name = profile.displayName;
              user.photos = profile.photos;
              user.library = userLibraryOfSongIDs;
              if(!user.appID){ user.appID = profile.id }
              user.save(function(err){ if(err) { console.log(err) } });
              return done(err, user);
            });
          });
        },
        function(err){
          console.log(err);
        }
      )
    }
  )
);

// Render the main page
app.get("/", function (req, res) {
  res.render("index", { user: req.user });
});

// Render individual user page based on their ID
app.get("/user/:username", ensureAuthenticated, function(req, res){
  User.findOne({username: req.params.username}, function(err, user){
    res.render("user", { user: user });
  });
});

// Render individual user page based on their ID
app.get("/user/:username/create", ensureAuthenticated, function(req, res){
  res.render("create", {user: req.user});
});

// Change an individual's app ID
app.post("/user/:username/change", ensureAuthenticated, function(req, res){
  var submittedID = req.sanitize(req.body.newID);
  if(_validateID(submittedID)){
    User.findOne({ username: req.user.username }, function(err, user){
      if(err){
        console.log(err);
      }
      user.appID = submittedID;
      user.save(function(err){
        if(err){
            console.log(err);
        }
      res.redirect("/user/" + req.user.username);
      });
    });
  } else {
    res.redirect("/user/" + req.user.username);
  }
});

// Find user based on submitted ID
app.post("/finduser", function(req, res){
  var submittedID = req.sanitize(req.body.id);
  User.findOne({appID: submittedID}, function(err, user){
    if(user){
      // Check if the found user has songs in their library
      if(user.library){
        var songsInCommon = [];
        req.user.library.forEach(function(track){

          // Change the ID to one that can be read by Spotify API
          var editedID = "spotify:track:" + track;
          if(user.library.includes(track) && !songsInCommon.includes(editedID)){
            songsInCommon.push(editedID);
          }
        });
        _createPlaylist(songsInCommon, req.user, user.name);
      }
    } else {
      console.log("This user does not exist!");
    }
  })

  // TO DO: redirect to a page which has some user feedback.
  res.redirect("/user/" + req.user.username + "/create");
});

// Authentication for spotify
app.get("/auth/spotify", passport.authenticate("spotify", {
    scope: ["user-read-email", "user-read-private", "user-library-read", "playlist-modify-public", "playlist-modify-private", "playlist-read-private"],
    showDialog: true
}));

app.get(authCallbackPath, passport.authenticate("spotify", { failureRedirect: "/" }), function (req, res) {
    res.redirect("/user/" + req.user.username);
  }
);

app.get("/logout", function (req, res) {
  req.logout();
  res.redirect("/");
});

app.get("*", function(req, res){
  res.redirect("/");
});

app.listen(port, function () {
  console.log("App is listening on port " + port);
});

function ensureAuthenticated(req, res, next) {
  if(req.isAuthenticated() && req.user.username === req.params.username) {
    return next();
  }
  res.redirect("/");
}