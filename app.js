var express = require("express"),
    session = require("express-session"),
    passport = require("passport"),
    SpotifyStrategy = require("passport-spotify").Strategy,
    consolidate = require("consolidate"),
    config = require('./config.json');

require("dotenv").config();

var port = 8888;
var authCallbackPath = "/callback";

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
      process.nextTick(function () {
        // To keep the example simple, the user's spotify profile is returned to
        // represent the logged-in user. In a typical application, you would want
        // to associate the spotify account with a user record in your database,
        // and return that user instead.
        return done(null, profile);
      });
    }
  )
);

var app = express();

// configure Express
app.set("views", __dirname + "/views");
app.set("view engine", "html");

app.use(
  session({ secret: "ninja warrior", resave: true, saveUninitialized: true })
);

app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(__dirname + "/public"));
app.engine("html", consolidate.nunjucks);

// Routes
app.get("/", function (req, res) {
  res.render("index.html", { user: req.user });
});

app.get("/account", ensureAuthenticated, function (req, res) {
  res.render("account.html", { user: req.user });
});

app.get("/login", function (req, res) {
  res.render("login.html", { user: req.user });
});

app.get(
  "/auth/spotify",
  passport.authenticate("spotify", {
    scope: ["user-read-email", "user-read-private"],
    showDialog: true,
  })
);

app.get(
  authCallbackPath,
  passport.authenticate("spotify", { failureRedirect: "/login" }),
  function (req, res) {
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
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect("/login");
}