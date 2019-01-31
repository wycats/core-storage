"use strict";
exports.__esModule = true;
var ts = require("typescript");
var path = require("path");
var fs = require("fs");
var rimraf = require("rimraf");
var formatHost = {
    getCanonicalFileName: function (path) { return path; },
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: function () { return ts.sys.newLine; }
};
var trace = process.env["BUILD_TRACE"]
    ? function () {
        var s = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            s[_i] = arguments[_i];
        }
        return console.log.apply(console, s);
    }
    : function () { return null; };
var root = path.resolve(__dirname, "..");
var dist = path.resolve(root, "dist");
function watchMain() {
    trace("removing", dist);
    rimraf.sync(dist);
    var configPath = ts.findConfigFile(
    /*searchPath*/ "../", ts.sys.fileExists, "tsconfig.json");
    if (!configPath) {
        throw new Error("Could not find a valid 'tsconfig.json'.");
    }
    // TypeScript can use several different program creation "strategies":
    //  * ts.createEmitAndSemanticDiagnosticsBuilderProgram,
    //  * ts.createSemanticDiagnosticsBuilderProgram
    //  * ts.createAbstractBuilder
    // The first two produce "builder programs". These use an incremental strategy
    // to only re-check and emit files whose contents may have changed, or whose
    // dependencies may have changes which may impact change the result of prior
    // type-check and emit.
    // The last uses an ordinary program which does a full type check after every
    // change.
    // Between `createEmitAndSemanticDiagnosticsBuilderProgram` and
    // `createSemanticDiagnosticsBuilderProgram`, the only difference is emit.
    // For pure type-checking scenarios, or when another tool/process handles emit,
    // using `createSemanticDiagnosticsBuilderProgram` may be more desirable.
    var createProgram = ts.createSemanticDiagnosticsBuilderProgram;
    // Note that there is another overload for `createWatchCompilerHost` that takes
    // a set of root files.
    var host = ts.createWatchCompilerHost(configPath, {
        noEmit: false
    }, ts.sys, createProgram, reportDiagnostic, reportWatchStatusChanged);
    // You can technically override any given hook on the host, though you probably
    // don't need to.
    // Note that we're assuming `origCreateProgram` and `origPostProgramCreate`
    // doesn't use `this` at all.
    var origCreateProgram = host.createProgram;
    host.createProgram = function (rootNames, options, host, oldProgram) {
        trace("** We're about to create the program! **");
        trace("rootNames", rootNames);
        trace("options", options);
        trace("host", host);
        trace("oldProgram", oldProgram);
        return origCreateProgram(rootNames, options, host, oldProgram);
    };
    var origPostProgramCreate = host.afterProgramCreate;
    host.afterProgramCreate = function (program) {
        trace("** We finished making the program! **");
        trace("program", program.getProgram());
        var root = program.getCurrentDirectory();
        trace("root", root);
        for (var _i = 0, _a = program.getSourceFiles(); _i < _a.length; _i++) {
            var file = _a[_i];
            if (isNodeModules(file.fileName))
                continue;
            var deps = program
                .getAllDependencies(file)
                .filter(function (f) { return isNested(root, f) && !isNodeModules(f); })
                .map(function (f) { return path.relative(root, f); });
            if (deps.length === 0)
                continue;
            trace("deps of " + path.relative(root, file.fileName), deps);
        }
        origPostProgramCreate(program);
        var packageDist = path.join(root, "packages", "core-storage", "dist");
        var repoDist = path.join(root, "dist", "packages", "core-storage");
        var stat;
        try {
            stat = fs.lstatSync(packageDist);
        }
        catch (e) {
            if (e.errno !== -4058) {
                throw e;
            }
            trace("Didn't find " + packageDist + ", creating a symlink to " + repoDist);
            fs.symlinkSync(repoDist, packageDist, "junction");
            return;
        }
        if (stat.isSymbolicLink()) {
            return;
        }
        console.warn("Found " + packageDist + ", but it wasn't a symlink. Deleting it.");
        rimraf.sync(packageDist);
        trace("Creating a symlink to " + repoDist);
        fs.symlinkSync(repoDist, packageDist, "junction");
    };
    // `createWatchProgram` creates an initial program, watches files, and updates
    // the program over time.
    ts.createWatchProgram(host);
}
function reportDiagnostic(diagnostic) {
    console.error("Error", diagnostic.code, ":", ts.flattenDiagnosticMessageText(diagnostic.messageText, formatHost.getNewLine()));
}
/**
 * Prints a diagnostic every time the watch status changes.
 * This is mainly for messages like "Starting compilation" or "Compilation completed".
 */
function reportWatchStatusChanged(diagnostic) {
    console.info(ts.formatDiagnostic(diagnostic, formatHost));
}
watchMain();
function isNested(parent, child) {
    var relative = path.relative(parent, child);
    return relative.slice(0, 2) !== "..";
}
function isNodeModules(file) {
    return path
        .normalize(file)
        .split(path.sep)
        .some(function (p) { return p === "node_modules"; });
}
