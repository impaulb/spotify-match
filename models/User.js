var mongoose = require("mongoose");
var passportLocalMongoose = require("passport-local-mongoose");
var findOrCreate = require('mongoose-findorcreate');


// SCHEMA
var userSchema = new mongoose.Schema({
  username: String,
  appID: String,
  name: String,
  photos: [],
  library: [],
  spotify_match_playlists: []
});

userSchema.plugin(passportLocalMongoose);
userSchema.plugin(findOrCreate);

module.exports = mongoose.model("User", userSchema);