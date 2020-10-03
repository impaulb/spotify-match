// BUG: entering blank into user ID causes crash

const { resolve, all } = require("bluebird");
const { lib } = require("nunjucks");
const { type } = require("os");
const { pathMatch } = require("tough-cookie");

var express = require("express"),
    mongoose = require("mongoose"),
    session = require("express-session"),
    passport = require("passport"),
    SpotifyStrategy = require("passport-spotify").Strategy,
    expressSanitizer = require("express-sanitizer"),
    override = require("method-override"),
    bodyParser = require("body-parser"),
    config = require('./config.json'),
    Promise = require('bluebird'),
    request = require('request-promise-native'),
    flash = require('connect-flash'),
    _ = require('underscore'),
    SpotifyAPI = require('spotify-web-api-node'),
    User = require("./models/User.js");

    require("dotenv").config();

const port = 8888;
const authCallbackPath = "/callback";
const connectionString = config.connectionString;

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
app.use(flash());

// Flash set up
app.use(function(req, res, next){
  res.locals.error = req.flash("error");
  res.locals.success = req.flash("success");
  next();
});

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
 * @return {Boolean} If the playlist was created successfully
 */
async function _createPlaylist(songIDs, user1, user2_name){

  // Check if the list of song IDs is empty
  if(!songIDs[0]){
    console.log("You don't have any songs in common!");
    return false;
  } else {

    // Check if there are more than 50 songs in common, if so, limit to 50 (to be removed)
    if(songIDs.length > 50){
      songIDs = songIDs.slice(0, 50);
    }

    // Use the Spotify API to create the playlist
    return new Promise (resolve => {
      spotifyApi.createPlaylist(user1.username, 'Spotify Match: ' + user2_name + ' & ' + user1.name, { 'public' : false })
      .then(function(playlistData) {
        spotifyApi.addTracksToPlaylist(playlistData.body.id, songIDs)
        .then(function(data){
          User.findOne({username: user1.username}).exec(function(err, user){
            if(err){
              console.log("Something went wrong!", err);
            } else {
              user.spotify_match_playlists.push(playlistData.body.id);
              user.save(function(err){
                if(err){
                  console.log("Something went wrong!", err);
                } else {
                  resolve(true);
                }
              })
            }
          })
        },
        function(err){
          console.log('Something went wrong (creating playlist)!', err);
          resolve(false);
        })
      }, 
      function(err) {
        console.log('Something went wrong (creating playlist)!', err);
        resolve(false);
      });
    }) 
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

/**
 * Validate a user's ID
 * @param  {String} id User ID to validate
 * @return {Boolean} Return if the id is valid or not
 */
function _validateID(id){
  return(id && /^[a-z0-9]+$/i.test(id) && id.length > 3);
}

/**
 * Get all of user's tracks in playlists
 * @param  {String} id User ID to validate
 * @param  {String} accessToken Spotify access token
 * @return {Array} Return an array of all songs in user's playlists
 */
async function _getPlaylistTracks(id, accessToken){

  return new Promise(resolve => {
    spotifyApi.getUserPlaylists(id, accessToken)
    .then(function(data) {
      var playlistPromises = [];

      // Push promises for each playlist
      data.body.items.forEach(function(playlist){
        playlistPromises.push(_getPlaylistData(playlist.id));
      });

      // Once all promises are resolved
      Promise.all(playlistPromises)
      .then(results => {
        var allSongs = [];
        results.forEach(function(result){
          allSongs = allSongs.concat(result);
        });
        resolve(allSongs);
      });
    },function(err) {
      console.log('Something went wrong!', err);
    });
  });
}

/**
 * Get all of songs in a playlist
 * @param  {String} playlistId ID of a playlist (NOT URI)
 * @return {Array} Return an array of all songs in playlist
 */
async function _getPlaylistData(playlistId){
  return new Promise(resolve => {
    spotifyApi.getPlaylistTracks(playlistId)
    .then(function(data){
      
      // Check if the playlist isn't empty
      if(data.body.items.length > 0){
        var tracks = [];
        data.body.items.forEach(function(track){
          tracks.push(track.track.id);
        });
        resolve(tracks);
      } else {
        resolve([]);
      }
    },
    function(err){
      console.log(err);
    })
  });
}

// Use Passport.JS Spotify strategy to authenticate user into the app
passport.use(
  new SpotifyStrategy(
    {
      clientID: config.clientID,
      clientSecret: config.clientSecret,
      callbackURL: "http://localhost:" + port + authCallbackPath,
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
          var libraryPromises = [];

          // Loop to get the entire user's library
          // NOTE: Spotify's API limits the number of songs returned to 50
          // so this has to be done to circumvent that
          for(let i = 0; i < libraryLength/50; i++){
            libraryPromises.push(new Promise((resolve) => {
              let songs = _getDataOfPage(accessToken, i * 50, 50);
              resolve(songs);
            }));
          }

          var playlistTracks = [];
          // Request a list of all user playlists then retrieve
          // all of the songs inside each playlist.

          var userLibraryOfSongIDs = [];
          // Construct user's entire song library from resolved Promises
          // and extract song IDs to store
          Promise.map(libraryPromises, Promise.props)
          .then(results => {
            results.forEach(function(result){
              result.items.forEach(function(trackWrapper){
                userLibraryOfSongIDs.push(trackWrapper.track.id);
              });
            })
          })
          .then(function(){
            // Find or create a user using all of the specified data
            User.findOrCreate({ username: profile.id }, function(err, user) {

              // Crude way to add 
              _getPlaylistTracks(profile.id, accessToken)
              .then(function(userPlaylistsSongIDs){
                user.name = profile.displayName;
                user.photos = profile.photos;

                // Uses Underscore.js to forn a super-library of sorts
                user.library = _.union(userLibraryOfSongIDs, userPlaylistsSongIDs);
                if(!user.appID){ user.appID = profile.id }
                user.save(function(err){ if(err) { req.flash("error", err); console.log(err) } });
                return done(err, user);
              });
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

// Render the tutorial page
app.get("/tutorial", function (req, res) {
  res.render("tutorial", { user: req.user });
});

// Render individual user page based on their ID
app.get("/user/:username", ensureAuthenticated, function(req, res){
  User.findOne({username: req.params.username}, function(err, user){
    res.render("user", { user: user });
  });
});

// Render the page to create new playlists
app.get("/user/:username/create", ensureAuthenticated, function(req, res){
  res.render("create", {user: req.user});
});

// Create a new playlist with another user
app.post("/user/:username/create", ensureAuthenticated, function(req, res){
  const userID = req.sanitize(req.body.id);
  if(_validateID(userID)){
    User.findOne({appID: req.body.id}).exec(function(err, user){
      if(err){
        req.flash("error", err);
        res.redirect("/user/" + req.user.username);
      } else {
        if(user){
          var songsInCommon = [];
          for(let i = 0; i < req.user.library.length; i++){
            const curSong = req.user.library[i];
            if(user.library.includes(curSong)){
              songsInCommon.push("spotify:track:" + curSong);
            }
          }
          if(_createPlaylist(songsInCommon, req.user, user.name)){
            req.flash("success", "Spotify Match playlist has been created successfully!");
            res.redirect("/user/" + req.user.username);
          } else {
            req.flash("error", "Something went wrong.. Try again and if it still doesn't work, please contact me!");
            res.redirect("/user/" + req.user.username);
          }
        } else {
          req.flash("error", "This user does not exist.");
          res.redirect("/user/" + req.user.username);
        }
      }
    });
  } else {
    req.flash("error", "The ID you entered is invalid.");
    res.redirect("/user/" + req.user.username);
  }
});

// Change an individual's app ID
app.post("/user/:username/change", ensureAuthenticated, function(req, res){
  var submittedID = req.sanitize(req.body.newID);
  User.findOne({appID: submittedID}).exec(function(err, user){
    if(err){
      req.flash("error", err);
      res.redirect("/user/" + req.user.username);
    } else {

      // Check to see if the ID is valid and is unique
      if(!user && _validateID(submittedID)){
        User.findOne({username: req.user.username}).exec(function(err, user){
          if(err){
            req.flash("error", err);
            res.redirect("/user/" + req.user.username);
          } else {
            user.appID = submittedID;
            user.save();
            res.redirect("/user/" + req.user.username);
          }
        })
      } else {
        req.flash("error", "ID must be unique and longer than 4 letters without special characters.");
        res.redirect("/user/" + req.user.username);
      }
    }
  });
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
  req.flash("error", "That page does not exist!");
  if(req.user){
    res.redirect("/user/" + req.user.username);
  } else {
    res.redirect("/");
  }
});

app.listen(port, function () {
  console.log("App is listening on port " + port);
});

function ensureAuthenticated(req, res, next) {
  if(req.isAuthenticated() && req.user.username === req.params.username) {
    return next();
  }
  req.flash("error", "You can't access that page. Try logging in!");
  res.redirect("/");
}