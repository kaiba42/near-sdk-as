const path = require("path");
const fs = require("fs");
const webpack = require("webpack");

// Creates the webpack config
// Need to provide a local installation of webpack since external packages will use this
// files: object of name: path, for each transformer
// outfolder: where to put the generated files
// toBundle: list of paths of files that will be bundled and available
// to the transformer via the `BUNDLE` global variable.
function _config(files, outfolder, toBundle) {
  const config = {
    entry: files,
    module: {
      rules: [
        {
          test: /\.ts$/,
          loader: "ts-loader"
        }
      ]
    },
    resolve: {
      extensions: [".ts", ".js"]
    },
    externals: ["assemblyscript"],
    output: {
      filename: "index.js",
      path: outfolder,
      library: "transformer",
      libraryTarget: "umd",
      globalObject: "typeof self !== 'undefined' ? self : this"
    },
    node: {
      fs: "empty"
    }
  };
  return (env, argv) => {
    let dev = false;
    if (argv.mode == "development") {
      config.devtool = "source-map";
      dev = true;
    } else {
      argv.mode = "production";
    }
    config.plugins = [
      new webpack.DefinePlugin({
        DEV: dev,
        BUNDLE: (() => {
          if (toBundle) {
            const lib = {};
            toBundle.forEach(
              file =>
                (lib[path.basename(file).replace(/\.ts$/, "")] = bundleFile(
                  file
                ))
            );
            return lib;
          }
        })()
      })
    ];
    return config;
  };
}
function bundleFile(filename) {
  return JSON.stringify(
    fs.readFileSync(filename, { encoding: "utf8" }).replace(/\r\n/g, "\n")
  );
}

module.exports = _config;