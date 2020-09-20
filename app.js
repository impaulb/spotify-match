// BUG: entering blank into user ID causes crash

var express = require("express"),
    mongoose = require("mongoose"),
    session = require("express-session"),
    passport = require("passport"),
    SpotifyStrategy = require("passport-spotify").Strategy,
    expressSanitizer = require("express-sanitizer"),
    override = require("method-override"),
    bodyParser = require("body-parser"),
    config = require('./config.json'),
    SpotifyAPI = require('spotify-web-api-node');
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

passport.use(
  new SpotifyStrategy(
    {
      clientID: config.clientID,
      clientSecret: config.clientSecret,
      callbackURL: "http://localhost:" + port + authCallbackPath,
    },
    function (accessToken, refreshToken, expires_in, profile, done) {
      spotifyApi.setAccessToken(accessToken);

      spotifyApi.getMySavedTracks()
      .then(function(data) {
        User.findOrCreate({ username: profile.id }, function(err, user) {
          user.name = profile.displayName;
          data.body.items.forEach(function(trackWrapper){
            user.library.push(trackWrapper.track.id);
          });
          user.photos = profile.photos;

          user.save(function(err){ if(err) { console.log(err) } })

          return done(err, user);
        });
      }, function(err) {
        console.log('Something went wrong!', err);
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