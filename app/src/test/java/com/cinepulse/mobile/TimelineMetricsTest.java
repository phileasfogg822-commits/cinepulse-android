package com.cinepulse.mobile;

import org.junit.Test;
import static org.junit.Assert.*;

public class TimelineMetricsTest {
    @Test public void epochSecondsAndMillisecondsAreEquivalent(){
        assertEquals(1760702400000L,TimelineMetrics.millis(1760702400L));
        assertEquals(1760702400000L,TimelineMetrics.millis(1760702400000L));
        assertEquals(1760702400000L,TimelineMetrics.millis("2025-10-17T12:00:00Z"));
    }
    @Test public void readableDurationsDoNotInventExecutionTime(){
        assertEquals("Not reported",TimelineMetrics.interval(0,0,9000));
        assertEquals("1m 02s",TimelineMetrics.duration(62000));
        assertEquals("25s (ongoing)",TimelineMetrics.interval(100000,0,125000));
        assertEquals("2m 05s",TimelineMetrics.interval(100000,225000,500000));
        assertEquals("Not available",TimelineMetrics.duration(-2000));
    }
    @Test public void diagnosticTextRedactsTokensAndLinks(){
        String text=TimelineMetrics.safeLabel("Bearer abc-secret https://x.invalid/path?sig=secret",180);
        assertFalse(text.contains("abc-secret"));
        assertFalse(text.contains("x.invalid"));
    }
    @Test public void expectedStageNamesUseConcreteLabels(){
        assertEquals("Story digest / movie understanding",TimelineMetrics.stageLabel("digest"));
        assertEquals("English timed SRT",TimelineMetrics.stageLabel("srt_english"));
    }
}
