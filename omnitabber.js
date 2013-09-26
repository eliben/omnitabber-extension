'use strict';

// Populated while user is entering input. Contains the ID of the tab that's the
// highest-ranked match for the input entered so far by the user. Used to decide
// on a tab when the user just presses enter without explicitly selecting one of
// the suggested results.
var top_match_id;

// An array of active chrome.Tab objects at the time the user tries to find
// a match. It's populated by onInputStarted.
var active_tabs;

// Compute the match score of the given chrome.Tab object for the given search
// words (array of strings).
// Returns object with properties:
//    {score, url_match_offsets, title_match_offsets}
//
// See README for the scoring algorithm.
function compute_tab_match_score(tab, searchwords) {
  var title = tab.title.toLowerCase().replace(/\W+/g, '');
  var url = tab.url.toLowerCase().replace(/\W+/g, '');

  var total_score = 0;
  var url_match_offsets = [];
  var title_match_offsets = [];

  for (var i = 0; i < searchwords.length; i++) {
    var word = searchwords[i];
    var title_result = compute_word_match_score(title, word);
    if (title_result['score'] > 0) {
      // Match succeeded in the title. Add up the score (scaling it properly)
      // and match offset for this word, and move on to the next word.
      total_score += title_result['score'] * 2;
      title_match_offsets.push({'index': title_result['match_index'],
                                'length': word.length});
    } else {
      // Match failed in the title. Try in the URL. If we fail here too, then
      // the whole match fails.
      var url_result = compute_word_match_score(url, word);
      if (url_result['score'] > 0) {
        total_score += url_result['score'];
        url_match_offsets.push({'index': url_result['match_index'],
                                'length': word.length});
      } else {
        return {'score': 0, 'url_match_offsets': [], 'title_match_offsets': []};
      }
    }
  }

  // If we got this far, all words matched successfully either in the title or
  // in the URL.
  return {
    'score': total_score,
    'url_match_offsets': url_match_offsets,
    'title_match_offsets': title_match_offsets};
}

// Compute the match score and location of word within the given text.
// Returns object with properties: {score, match_index}.
// If there's no match, it will be {score=0, match_index=-1}.
function compute_word_match_score(text, word) {
  var match_index = text.indexOf(word);
  if (match_index < 0) {
    return {'score': 0, 'match_index': -1};
  } else {
    var score = word.length * 100 - match_index;
    if (match_index == 0) {
      score += 200;
    }

    return {'score': score, 'match_index': match_index};
  }
}

function escape(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeRegexp(text) {
  var specialChars = [
    '\\',
    '[',
    ']',
    '(',
    ')',
    '|',
    '.',
    '+',
    '?',
    '{',
    '}',
    '-'
  ];

  return text.split('').map(function(char) {
    if (specialChars.indexOf(char) > -1)
      return '\\' + char;
    else
      return char;
  }).join('');
}

function parseMatches(text, search) {
  var terms = escapeRegexp(search).split(/\s+/g);
  var termMatchCounts = [];
  terms.forEach(function() { termMatchCounts.push(0); });
  var re = new RegExp("(" + terms.join(")|(") + ")", "ig");
  var result = [];
  var lastIndex = 0;
  var match;
  while (match = re.exec(text)) {
    result.push({
      match: false,
      text: escape(text.substring(lastIndex, match.index))
    });

    lastIndex = match.index + match[0].length;
    result.push({
      match: true,
      text: escape(text.substring(match.index, lastIndex))
    });

    for (var i = 1; i < match.length; i++) {
      if (match[i])
        termMatchCounts[i - 1]++;
    }
  }

  // If any term found no matches, then we don't have a match.
  if (termMatchCounts.indexOf(0) > -1) {
    return [
      {
        match: false,
        text: escape(text)
      }
    ];
  }

  result.push({
    match: false,
    text: escape(text.substring(lastIndex))
  });

  return result;
}

function formatMatches(parsed) {
  return parsed.reduce(function(s, piece) {
    if (piece.match)
      return s + "<match>" + piece.text + "</match>";
    else
      return s + piece.text;
  }, "");
}

chrome.omnibox.onInputChanged.addListener(function(text, suggest) {
  // Replace runs of non-word chars with spaces
  text = text.toLowerCase().replace(/\W+/g, ' ').trim();
  if (!text)
    return;
  var words = text.split(/\s+/g);

  console.log('active_tabs', active_tabs);
  var matching_tabs = [];
  for (var i = 0; i < active_tabs.length; i++) {
    var tab = active_tabs[i];
    var result = compute_tab_match_score(tab, words);
    if (result['score'] > 0) {
      // TODO: bump score if in the same window as current tab
      matching_tabs.push({
        'tab': tab,
        'score': result['score'],
        'url_match_offsets': result['url_match_offsets'],
        'title_match_offsets': result['title_match_offsets']});
    }
  }
  console.log(matching_tabs);

  var suggestions = active_tabs.map(function(tab) {
    // Attempt to produce suggestions for all tabs
    return {
      tab: tab,
      title: parseMatches(tab.title, text),
      url: parseMatches(tab.url, text)
    };
  }).filter(function(item) {
    // Filter those with any matches
    if (item.title.length > 1 || item.url.length > 1) {
      if (top_match_id == -1)
        top_match_id = item.tab.id;
      return true;
    } else {
      return false;
    }
  }).map(function(item) {
    // Prepare suggestions by building objects expected by the 'suggest'
    // callback.
    return {
      content: item.tab.title + ' - ' + item.tab.url + '##' + item.tab.id,
      description: formatMatches(item.title) + ' - ' +
                   '<url>' + formatMatches(item.url) + '</url>'
    };
  });

  suggest(suggestions);
});

// The user has accepted what is typed into the omnibox.
// text: the suggested text selected by the user
chrome.omnibox.onInputEntered.addListener(function(text) {
  // Extract the tab id encoded in the text. If there's none, maybe the user
  // didn't select any suggestion. In this case, try to see if there's a top
  // matching id available.
  var tab_id = text.match(/##(\d+)$/);
  if (tab_id) {
    tab_id = parseInt(tab_id[1]);
  } else if (top_match_id != -1) {
    tab_id = top_match_id;
  } else {
    return;
  }

  // Get hold of the tab with the selected id.
  chrome.tabs.get(tab_id, function(tab) {
    if (tab) {
      // Switch to the tab by selecting it and focusing its containing window.
      chrome.tabs.update(tab_id, {selected: true});

      chrome.windows.get(tab.windowId, function(win) {
        if (!win.focused) {
          chrome.windows.update(tab.windowId, {focused: true});
        }
      });
    }
  });
});

// Stuff to do every time a new Omnitabber session starts
chrome.omnibox.onInputStarted.addListener(function() {
  active_tabs = [];
  // Collect all tabs in the currently open windows
  chrome.windows.getAll({populate: true}, function(wins) {
    wins.forEach(function(win) {
      win.tabs.forEach(function(tab) {
        active_tabs.push(tab);
      });
    });
  });

  // Reset the top matching tab id
  top_match_id = -1;
});

