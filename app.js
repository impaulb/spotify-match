// BUG: entering blank into user ID causes crash

const { resolve, all } = require("bluebird");
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

app.use(
  session({ secret: "ninjawarrior", resave: true, saveUninitialized: true })
);

// MongoDB set up
mongoose.connect(connectionString, {useUnifiedTopology: true, useNewUrlParser: true});

// Spotify API set up
var spotifyApi = new SpotifyAPI();

// Passport set up
passport.serializeUser(function (user, done) {
  done(null, user);
});

passport.deserializeUser(function (obj, done) {
  done(null, obj);
});

async function getSongsOfSelectedPage(accessToken){
  return new Promise(resolve => {
    const userLibrary = request({
      method: 'GET',
      uri: `https://api.spotify.com/v1/me/tracks?limit=1`,
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      json: true
      });
    resolve(userLibrary.total);
  });
}

async function getSongsOfSelectedPage(accessToken, offset){
  return new Promise(resolve => {
    const userLibrary = request({
      method: 'GET',
      uri: `https://api.spotify.com/v1/me/tracks?limit=50&offset=${offset}`,
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      json: true
      });
    resolve(userLibrary);
  });
}


passport.use(
  new SpotifyStrategy(
    {
      clientID: config.clientID,
      clientSecret: config.clientSecret,
      callbackURL: "http://localhost:" + port + authCallbackPath,
    },

    // Authenticate a user and pull their music library into database
    async function (accessToken, refreshToken, expires_in, profile, done) {
      spotifyApi.setAccessToken(accessToken);
      
      var promises = [];
      let i = 0;

      const libraryLengthWrapper = await request({
        method: 'GET',
        uri: `https://api.spotify.com/v1/me/tracks?limit=1`,
        headers: {
          Authorization: `Bearer ${accessToken}`
        },
        json: true
      });
      const libraryLength = libraryLengthWrapper.total;

      while(i < libraryLength/50){
        promises.push(new Promise((resolve) => {
          let songs = getSongsOfSelectedPage(accessToken, i * 50);
          resolve(songs);
        }));
        i++;
      }

      Promise.map(promises, Promise.props)
      .then(results => {
        var userLibraryOfSongIDs = [];
        results.forEach(function(result){
          result.items.forEach(function(trackWrapper){
            userLibraryOfSongIDs.push(trackWrapper.track.id);
          });
        })
        User.findOrCreate({ username: profile.id }, function(err, user) {
          user.name = profile.displayName;
          user.photos = profile.photos;
          user.library = userLibraryOfSongIDs;
          user.save(function(err){ if(err) { console.log(err) } })
          return done(err, user);
        });
      });
    }
  )
);

app.use(passport.initialize());
app.use(passport.session());

// Routes
app.get("/", function (req, res) {
  res.render("index", { user: req.user });
});

// TO DO: OPTIMIZE THIS MONSTROUSITY
app.post("/finduser", function(req, res){
  User.findOne({username: req.body.id}, function(err, user){
    if(err){
      console.log(err);
    } else {
      var searchedLibrary = user.library;
      var songsInCommon = [];

      req.user.library.forEach(function(track){
        var editedID = "spotify:track:" + track;
        if(searchedLibrary.includes(track) && !songsInCommon.includes(editedID)){
          songsInCommon.push(editedID);
        }
      });

      spotifyApi.createPlaylist(req.user.username, 'Spotify Match: ' + user.name + ' & ' + req.user.name, { 'public' : false })
      .then(function(data) {
        spotifyApi.addTracksToPlaylist(data.body.id, songsInCommon)
        .then(function(data) {
          console.log('Added tracks to playlist!');
        }, function(err) {
          console.log('Something went wrong (adding tracks)!', err);
        });
      }, function(err) {
        console.log('Something went wrong (creating playlist)!', err);
      });
      
    }
  })

  res.redirect("/");
});

app.get("/auth/spotify", passport.authenticate("spotify", {
    scope: ["user-read-email", "user-read-private", "user-library-read", "playlist-modify-public", "playlist-modify-private", "playlist-read-private"],
    showDialog: true
}));

app.get(authCallbackPath, passport.authenticate("spotify", { failureRedirect: "/" }), function (req, res) {
    res.redirect("/");
  }
);

app.get("/logout", function (req, res) {
  req.logout();
  res.redirect("/");
});

app.listen(port, function () {
  console.log("App is listening on port " + port);
});

function ensureAuthenticated(req, res, next) {
  if(req.isAuthenticated()) {
    return next();
  }
  res.redirect("/");
}