const { connect } = require("http2");

var express = require("express"),
    mongoose = require("mongoose"),
    session = require("express-session"),
    passport = require("passport"),
    SpotifyStrategy = require("passport-spotify").Strategy,
    consolidate = require("consolidate"),
    config = require('./config.json');

require("dotenv").config();

var port = 8888;
const authCallbackPath = "/callback";
const connectionString = config.connectionString;

mongoose.connect(connectionString, {useUnifiedTopology: true, useNewUrlParser: true});

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
      return done(null, profile);
    }
  )
);

var app = express();

// configure Express
app.set("views", __dirname + "/views");
app.set("view engine", "html");

app.use(
  session({ secret: "ninjawarrior", resave: true, saveUninitialized: true })
);

app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(__dirname + "/public"));
app.engine("html", consolidate.nunjucks);

// Routes
app.get("/", function (req, res) {
    console.log(req.user);
  res.render("index.html", { user: req.user });
});

app.get("/account", ensureAuthenticated, function (req, res) {
  res.render("account.html", { user: req.user });
});

app.get("/login", function (req, res) {
  res.render("login.html", { user: req.user });
});

app.get("/auth/spotify", passport.authenticate("spotify", {
    scope: ["user-read-private", "user-library-read"],
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
  res.redirect("/login");
}