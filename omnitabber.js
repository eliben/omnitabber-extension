'use strict';

var top_match_id;

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
  text = text.toLowerCase().replace(/\W+/g, ' ').trim();
  if (!text)
    return;

  // Run a callback on all open windows. populate: true to include the .tabs
  // property with each window.
  chrome.windows.getAll({populate: true}, function(windows) {
    top_match_id = -1;

    var tabs = windows.reduce(function(arr, win) {
      return arr.concat(win.tabs);
    }, []);

    var suggestions = tabs.map(function(tab) {
      return {
        tab: tab,
        title: parseMatches(tab.title, text),
        url: parseMatches(tab.url, text)
      };
    }).filter(function(item) {
      if (item.title.length > 1 || item.url.length > 1) {
        if (top_match_id == -1)
          top_match_id = item.tab.id;
        return true;
      } else {
        return false;
      }
    }).map(function(item) {
      return {
        content: item.tab.title + ' - ' + item.tab.url + '##' + item.tab.id,
        description: formatMatches(item.title) + ' - ' +
                     '<url>' + formatMatches(item.url) + '</url>'
      };
    });

    suggest(suggestions);
  });
});

// The user has accepted what is typed into the omnibox.
// text: the suggested text selected by the user
chrome.omnibox.onInputEntered.addListener(function(text) {
  // Extract the tab id encoded in the text
  var tab_id = text.match(/##(\d+)$/);
  if (tab_id)
    tab_id = parseInt(tab_id[1]);
  else if (top_match_id != -1)
    tab_id = top_match_id;
  else
    return;

  chrome.tabs.get(tab_id, function(tab) {
    if (tab && !tab.selected) {
      chrome.tabs.update(tab_id, {
        selected: true
      });
    }

    chrome.windows.get(tab.windowId, function(win) {
      if (!window.focused) {
        chrome.windows.update(tab.windowId, {
          focused: true
        });
      }
    });
  });
});

chrome.omnibox.onInputStarted.addListener(function() {
  // Reset the top match id every time a new Omnitabber session starts.
  top_match_id = -1;
});

