/**
 * Verb <https://github.com/assemble/verb>
 * Generate markdown documentation for GitHub projects.
 *
 * Copyright (c) 2014 Jon Schlinkert, Brian Woodward, contributors.
 * Licensed under the MIT license.
 */

'use strict';

var path = require('path');
var cwd = require('cwd');
var file = require('fs-utils');
var configFile = require('config-file');
var relative = require('relative');
var toc = require('marked-toc');
var _ = require('lodash');
var pkg = require('./package.json');


/**
 * verb
 */

var verb = module.exports = {};

/**
 * Initialize API
 */

verb.cwd          = cwd;
verb.base         = cwd;
verb.docs         = verb.cwd('docs');
verb.ext          = '.md';
verb.file         = _.defaults(require('./lib/file'), file);

// Logging and utils
verb.colors       = require('./lib/colors');
verb.utils        = require('./lib/utils/index');
verb.log          = require('./lib/log');
verb.verbose      = verb.log.verbose;
verb.mode         = {};
verb.mode.verbose = false;

// Extensions
verb.plugins      = require('./lib/plugins');
verb.filters      = require('./lib/filters');
verb.tags         = require('./lib/tags');

// Templates
verb.scaffolds    = require('./lib/scaffolds');
verb.template     = require('./lib/template');

// Data
verb.data         = require('./lib/data');
verb.matter       = require('./lib/matter');

verb.exclusions   = require('./lib/exclusions');


/**
 * Allow tools in the Verb ecosystem to specify their
 * own name and url, so that any templates using
 * `runner.name` and `runner.url` will render with
 * that info.
 */

verb.runner = {
  name: 'Verb',
  url: 'https://github.com/assemble/verb'
};


/**
 * If one exists, automatically load the user's
 * runtime config file.
 *
 * @api {private}
 */

verb.verbrc = {};

/**
 * Initialize Verb and the Verb API
 *
 * @api {private}
 */

verb.init = function (options) {
  options = options || {};

  if (verb.initalized) {
    return;
  }

  verb.initalized = true;
  verb.mode.verbose = options.verbose || verb.mode.verbose;

  // Extend the config with core and user-defined mixins
  _.fn = require('./lib/mixins.js');
  _.mixin(_.fn);
};

/**
 * Process Lo-Dash templates using metadata from the user's config as context.
 * e.g. package.json and info from the local git repository.
 */

verb.process = function(src, options) {
  var opts = _.extend({toc: {maxDepth: 2}}, options);
  verb.init(opts);

  src = src || '';

  // Add runtime config
  var runtimeConfig = {};
  if(opts.verbrc) {
    runtimeConfig = configFile.load(cwd(opts.verbrc));
  } else {
    runtimeConfig = verb.verbrc;
  }

  _.extend(opts, runtimeConfig);

  verb.options = opts;

  verb.config = require('./lib/config').init(opts.config);
  verb.context = verb.config || {};
  delete verb.context.config;

  // Extend `verb`
  verb.layout = require('./lib/layout')(verb);

  // Build up the context
  _.extend(verb.context, opts);
  _.extend(verb.context, opts.metadata || {});
  _.extend(verb.context, require('./lib/data').init(opts));

  // Template settings
  var settings = opts.settings || {};

  // Initialize Lo-Dash tags and filters
  _.extend(verb.context, verb.tags.init(verb));
  _.extend(verb.context, verb.filters.init(verb));

  // Initialize `options.data`
  _.extend(verb.context, verb.data.init(opts));

  // Extract and parse front matter
  verb.page  = verb.matter(src, opts);
  _.extend(verb.context, verb.page.context);

  // Exclusion patterns, to omit certain options from context
  verb.context = verb.exclusions(verb.context, opts);
  _.extend(verb.context, {runner: verb.runner});

   // Initialize plugins
  _.extend(verb.context, verb.plugins.init(verb));

  // Process templates and render content
  var renderDone = false;
  var rendered = verb.template(verb.page.content, verb.context, settings);

  verb.tags.resolve(verb, rendered, function (err, results) {
    rendered = results;
    renderDone = true;
  });

  while (!renderDone) {
    process.nextTick();
  }
  var result = verb.utils.postProcess(rendered, opts);

  // Generate a TOC from <!-- toc --> after all content is included.
  result = toc.insert(result, opts.toc);

  return {
    verb: verb,
    context: verb.context,
    content: result,
    original: src
  };
};


/**
 * Read a source file and call `verb.process()`
 *
 * @param {String} src
 * @param {Object} options
 * @return {String} `content` from `verb.process()`
 */

verb.read = function(src, options) {
  options = options || {};
  verb.init(options);

  verb.options = verb.options || {};
  verb.options.src = verb.cwd(src);

  _.extend(verb.options, options);

  // Log the start.
  verb.verbose.write();
  verb.verbose.run('processing', relative(process.cwd(), src));

  var content = file.readFileSync(src);
  return verb.process(content, options).content;
};

/**
 * Read a source file and call `verb.process()`,
 * then write it to the specified `dest`.
 *
 * @param {String} src
 * @param {String} dest
 * @param {Object} options
 * @return {String} `content` from `verb.process()`
 */

verb.copy = function(src, dest, options) {
  options = options || {};
  verb.init(options);

  verb.options = verb.options || {};
  verb.options.src = verb.cwd(src);
  verb.options.dest = verb.cwd(dest);

  _.extend(options, verb.options);

  // Log the start.
  verb.log.write();
  verb.log.subhead('reading', file.normalizeSlash(src));

  // Write the actual files.
  file.writeFileSync(dest, verb.read(src, options));
  verb.log.run('writing', relative(process.cwd(), dest));

  // Log a success message.
  verb.log.write();
  verb.log.success('  ' + verb.runner.name + ' [done]');
  return;
};


/**
 * Expand globbing patterns into a src-dest mapping calculated
 * based on defaults and user-defined options. Read source files and
 * call `verb.process()`, then write the processed files to the
 * calculated `dest`.
 *
 * @param {String} src
 * @param {String} dest
 * @param {Object} [options] the options to use:
 *        [concat] concatenate dest files. Default `false`
 *        [sep] separator to use between files, if concatenated.
 *        [cwd] current working directory. Default `verb.cwd()`
 *        [ext] extension to use for dest files. Default `verb.ext` (`.md`)
 *        [destBase] the base directory for dest files.
 *        [glob] options to pass to [globule](https://github.com/cowboy/node-globule).
 * @return {String} `content` from `verb.process()`
 */

verb.expand = function(src, dest, options) {
  var opts = _.extend({concat: false}, options);
  opts.glob = opts.glob || {};

  verb.init(opts);

  verb.options = verb.options || {};
  verb.options.dest = verb.cwd(dest);

  _.extend(options, verb.options);

  var defaults = {
    sep: opts.sep || '\n',
    cwd: opts.cwd || verb.cwd('.'),
    ext: verb.ext || opts.ext,
    destBase: dest
  };
  defaults.srcBase = defaults.cwd;

  var concat = opts.concat || file.hasExt(dest) || false;
  var defer = [];

  // Pass users-defined options to globule
  _.extend(defaults, opts.glob);

  // Log the start.
  verb.log.write();
  verb.log('\n  Expanding files:', src);

  file.expandMapping(src, defaults).map(function(fp) {
    fp.src.filter(function(filepath) {
      if (!file.exists(filepath)) {
        verb.log.error('>> Source file "' + filepath + '" not found.');
        return false;
      } else {
        return true;
      }
    }).map(function(filepath) {
      verb.options.src = filepath;
      verb.log.run('reading', relative(process.cwd(), verb.options.src));

      if(!concat) {
        file.writeFileSync(fp.dest, verb.read(filepath, opts));
        verb.log.subhead('writing', relative(process.cwd(), fp.dest));
      } else {
        defer.push(filepath);
      }
    });
  });

  if(concat) {
    var blob = _.flatten(defer).map(function(filepath) {
      verb.options.src = filepath;

      // Log the start.
      verb.log.run('reading', relative(process.cwd(), verb.options.src));

      return verb.read(filepath, opts);
    }).join(opts.sep);


    file.writeFileSync(dest, blob);
    verb.log.subhead('writing', relative(process.cwd(), dest));
  }

  // Log a success message.
  verb.log.write();
  verb.log.success('  ' + verb.runner.name + ' [done]');
};
