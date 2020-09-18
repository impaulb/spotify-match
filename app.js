const port = 8888;
const authCallbackPath = "/callback";
const connectionString = config.connectionString;


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
        User.findOrCreate({ id: profile.id, name: profile.displayName, username: profile.email, library: data.body.items, photos: profile.photos }, function(err, user) {
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

app.get("/auth/spotify", passport.authenticate("spotify", {
    scope: ["user-read-email", "user-read-private", "user-library-read"],
    showDialog: true
}));

app.get(authCallbackPath, passport.authenticate("spotify", { failureRedirect: "/login" }), function (req, res) {
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