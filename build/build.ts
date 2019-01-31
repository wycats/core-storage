import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as rimraf from "rimraf";

const formatHost: ts.FormatDiagnosticsHost = {
  getCanonicalFileName: path => path,
  getCurrentDirectory: ts.sys.getCurrentDirectory,
  getNewLine: () => ts.sys.newLine
};

const trace = process.env["BUILD_TRACE"]
  ? (...s: unknown[]) => console.log(...s)
  : () => null;

const root = path.resolve(__dirname, "..");
const dist = path.resolve(root, "dist");

function watchMain() {
  trace("removing", dist);
  rimraf.sync(dist);

  const configPath = ts.findConfigFile(
    /*searchPath*/ "../",
    ts.sys.fileExists,
    "tsconfig.json"
  );
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
  const createProgram = ts.createSemanticDiagnosticsBuilderProgram;

  // Note that there is another overload for `createWatchCompilerHost` that takes
  // a set of root files.
  const host = ts.createWatchCompilerHost(
    configPath,
    {
      noEmit: false
    },
    ts.sys,
    createProgram,
    reportDiagnostic,
    reportWatchStatusChanged
  );

  // You can technically override any given hook on the host, though you probably
  // don't need to.
  // Note that we're assuming `origCreateProgram` and `origPostProgramCreate`
  // doesn't use `this` at all.
  const origCreateProgram = host.createProgram;
  host.createProgram = (
    rootNames: ReadonlyArray<string>,
    options,
    host,
    oldProgram
  ) => {
    trace("** We're about to create the program! **");
    trace("rootNames", rootNames);
    trace("options", options);
    trace("host", host);
    trace("oldProgram", oldProgram);
    return origCreateProgram(rootNames, options, host, oldProgram);
  };
  const origPostProgramCreate = host.afterProgramCreate;

  host.afterProgramCreate = program => {
    trace("** We finished making the program! **");
    trace("program", program.getProgram());

    let root = program.getCurrentDirectory();
    trace("root", root);

    for (let file of program.getSourceFiles()) {
      if (isNodeModules(file.fileName)) continue;

      let deps = program
        .getAllDependencies(file)
        .filter(f => isNested(root, f) && !isNodeModules(f))
        .map(f => path.relative(root, f));

      if (deps.length === 0) continue;

      trace(`deps of ${path.relative(root, file.fileName)}`, deps);
    }

    origPostProgramCreate!(program);

    let packageDist = path.join(root, "packages", "core-storage", "dist");
    let repoDist = path.join(root, "dist", "packages", "core-storage");

    let stat: fs.Stats;

    try {
      stat = fs.lstatSync(packageDist);
    } catch (e) {
      if (e.errno !== -4058) {
        throw e;
      }

      trace(`Didn't find ${packageDist}, creating a symlink to ${repoDist}`);
      // fs.symlinkSync(repoDist, packageDist, "junction");
      return;
    }

    if (stat.isSymbolicLink()) {
      return;
    }

    console.warn(`Found ${packageDist}, but it wasn't a symlink. Deleting it.`);
    rimraf.sync(packageDist);
    trace(`Creating a symlink to ${repoDist}`);
    // fs.symlinkSync(repoDist, packageDist, "junction");
  };

  // `createWatchProgram` creates an initial program, watches files, and updates
  // the program over time.
  ts.createWatchProgram(host);
}

function reportDiagnostic(diagnostic: ts.Diagnostic) {
  console.error(
    "Error",
    diagnostic.code,
    ":",
    ts.flattenDiagnosticMessageText(
      diagnostic.messageText,
      formatHost.getNewLine()
    )
  );
}

/**
 * Prints a diagnostic every time the watch status changes.
 * This is mainly for messages like "Starting compilation" or "Compilation completed".
 */
function reportWatchStatusChanged(diagnostic: ts.Diagnostic) {
  console.info(ts.formatDiagnostic(diagnostic, formatHost));
}

watchMain();

function isNested(parent: string, child: string): boolean {
  let relative = path.relative(parent, child);

  return relative.slice(0, 2) !== "..";
}

function isNodeModules(file: string) {
  return path
    .normalize(file)
    .split(path.sep)
    .some(p => p === "node_modules");
}
